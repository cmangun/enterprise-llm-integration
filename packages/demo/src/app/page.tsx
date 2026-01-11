'use client';

import { useState, useEffect } from 'react';
import {
  CostGuard,
  detectPII,
  evaluateConfidence,
  createAuditLog,
  type PIIResult,
  type ConfidenceResult,
  type AuditLogEntry,
  type BudgetCheckResult,
} from '../lib/governance';

// ============================================================================
// COST GUARD DEMO
// ============================================================================

function CostGuardDemo() {
  const [costCeiling, setCostCeiling] = useState(0.25);
  const [sessionLimit, setSessionLimit] = useState(5.0);
  const [dailyLimit, setDailyLimit] = useState(100.0);
  const [model, setModel] = useState('gpt-4o-mini');
  const [inputTokens, setInputTokens] = useState(500);
  const [outputTokens, setOutputTokens] = useState(200);
  const [guard] = useState(() => new CostGuard({
    maxCostPerRequest: 0.25,
    maxCostPerSession: 5.0,
    maxCostPerDay: 100.0,
  }));
  const [result, setResult] = useState<BudgetCheckResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    guard['config'] = { maxCostPerRequest: costCeiling, maxCostPerSession: sessionLimit, maxCostPerDay: dailyLimit };
  }, [costCeiling, sessionLimit, dailyLimit, guard]);

  const checkBudget = () => {
    const cost = guard.estimateCost(model, inputTokens, outputTokens);
    const check = guard.checkBudget(cost);
    setResult(check);
  };

  const simulateRequest = () => {
    const cost = guard.estimateCost(model, inputTokens, outputTokens);
    const check = guard.checkBudget(cost);
    if (check.allowed) {
      guard.recordUsage({ cost, timestamp: new Date(), model, tokens: inputTokens + outputTokens });
      setSimulating(true);
      setTimeout(() => setSimulating(false), 500);
    }
    setResult(guard.checkBudget(cost));
  };

  const stats = guard.getUsageStats();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <span className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-600">$</span>
        Cost Guard
      </h2>
      <p className="text-gray-600 text-sm mb-4">
        Budget enforcement with per-request, session, and daily limits. Prevents runaway API costs.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Per-Request Limit: ${costCeiling.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.01"
            max="1.00"
            step="0.01"
            value={costCeiling}
            onChange={(e) => setCostCeiling(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Session Limit: ${sessionLimit.toFixed(2)}
          </label>
          <input
            type="range"
            min="1"
            max="20"
            step="0.5"
            value={sessionLimit}
            onChange={(e) => setSessionLimit(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          >
            <option value="gpt-4o-mini">GPT-4o Mini</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-4-turbo">GPT-4 Turbo</option>
            <option value="claude-3-sonnet">Claude 3 Sonnet</option>
            <option value="claude-3-opus">Claude 3 Opus</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Input Tokens</label>
          <input
            type="number"
            value={inputTokens}
            onChange={(e) => setInputTokens(parseInt(e.target.value) || 0)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Output Tokens</label>
          <input
            type="number"
            value={outputTokens}
            onChange={(e) => setOutputTokens(parseInt(e.target.value) || 0)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={checkBudget}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm font-medium"
        >
          Check Budget
        </button>
        <button
          onClick={simulateRequest}
          disabled={simulating}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
        >
          {simulating ? 'Simulating...' : 'Simulate Request'}
        </button>
        <button
          onClick={() => { guard.reset(); setResult(null); }}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm font-medium"
        >
          Reset Session
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-gray-50 rounded">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.totalRequests}</div>
          <div className="text-xs text-gray-500">Requests</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">${stats.totalCost.toFixed(4)}</div>
          <div className="text-xs text-gray-500">Total Cost</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.totalTokens.toLocaleString()}</div>
          <div className="text-xs text-gray-500">Tokens</div>
        </div>
      </div>

      {result && (
        <div className={`p-3 rounded ${result.allowed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-lg ${result.allowed ? 'text-green-600' : 'text-red-600'}`}>
              {result.allowed ? '✓' : '✗'}
            </span>
            <span className={`font-medium ${result.allowed ? 'text-green-700' : 'text-red-700'}`}>
              {result.allowed ? 'Request Allowed' : 'Request Blocked'}
            </span>
          </div>
          <div className="text-sm text-gray-600">
            Estimated: ${result.estimatedCost.toFixed(4)} | 
            Remaining: ${result.remainingBudget.session.toFixed(2)} (session)
          </div>
          {result.reason && <div className="text-sm text-red-600 mt-1">{result.reason}</div>}
          {result.warnings.map((w, i) => (
            <div key={i} className="text-sm text-yellow-600 mt-1">⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PII DETECTOR DEMO
// ============================================================================

function PIIDetectorDemo() {
  const [input, setInput] = useState(
    'Contact John at john.doe@example.com or call 555-123-4567.\nSSN: 123-45-6789, Card: 4532-0151-1283-0366'
  );
  const [mode, setMode] = useState<'detect' | 'redact' | 'mask'>('redact');
  const [result, setResult] = useState<PIIResult | null>(null);

  const analyze = () => {
    setResult(detectPII(input));
  };

  useEffect(() => {
    analyze();
  }, [input]);

  const outputText = result 
    ? (mode === 'redact' ? result.redactedText : mode === 'mask' ? result.maskedText : result.originalText)
    : input;

  const typeColors: Record<string, string> = {
    ssn: 'bg-red-100 text-red-800',
    credit_card: 'bg-purple-100 text-purple-800',
    email: 'bg-blue-100 text-blue-800',
    phone: 'bg-green-100 text-green-800',
    ip_address: 'bg-yellow-100 text-yellow-800',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <span className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-600">🔒</span>
        PII Detector
      </h2>
      <p className="text-gray-600 text-sm mb-4">
        HIPAA-compliant detection of SSN, credit cards, email, phone numbers with Luhn validation.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Input Text</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm font-mono"
          placeholder="Enter text containing PII..."
        />
      </div>

      <div className="flex gap-2 mb-4">
        {(['detect', 'redact', 'mask'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded text-sm font-medium capitalize ${
              mode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Output</label>
        <div className="w-full border rounded px-3 py-2 text-sm font-mono bg-gray-50 whitespace-pre-wrap min-h-[80px]">
          {outputText}
        </div>
      </div>

      {result && result.detections.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Detected PII ({result.detections.length})
          </label>
          <div className="flex flex-wrap gap-2">
            {result.detections.map((d, i) => (
              <span
                key={i}
                className={`px-2 py-1 rounded text-xs font-medium ${typeColors[d.type] || 'bg-gray-100'}`}
              >
                {d.type.toUpperCase()}: {d.value} ({(d.confidence * 100).toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {result && result.detections.length === 0 && (
        <div className="text-sm text-green-600 flex items-center gap-2">
          <span>✓</span> No PII detected
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CONFIDENCE GATE DEMO
// ============================================================================

function ConfidenceGateDemo() {
  const [content, setContent] = useState(
    'I think the recommended dosage might be around 10mg, but I\'m not sure. You should probably consult a doctor.'
  );
  const [modelConfidence, setModelConfidence] = useState(0.75);
  const [minConfidence, setMinConfidence] = useState(0.7);
  const [maxUncertainty, setMaxUncertainty] = useState(0.3);
  const [requireCitations, setRequireCitations] = useState(false);
  const [result, setResult] = useState<ConfidenceResult | null>(null);

  const evaluate = () => {
    setResult(evaluateConfidence(content, modelConfidence, {
      minConfidence,
      maxUncertainty,
      requireCitations,
      minCitations: 2,
    }));
  };

  useEffect(() => {
    evaluate();
  }, [content, modelConfidence, minConfidence, maxUncertainty, requireCitations]);

  const categoryColors: Record<string, string> = {
    hedging: 'bg-yellow-100 text-yellow-800',
    speculation: 'bg-orange-100 text-orange-800',
    limitation: 'bg-red-100 text-red-800',
    approximation: 'bg-blue-100 text-blue-800',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <span className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600">⚖</span>
        Confidence Gate
      </h2>
      <p className="text-gray-600 text-sm mb-4">
        Response quality filtering with uncertainty detection. Routes low-confidence responses to human review.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">LLM Response</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm"
          placeholder="Enter LLM response to evaluate..."
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Model Confidence: {(modelConfidence * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={modelConfidence}
            onChange={(e) => setModelConfidence(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Min Confidence: {(minConfidence * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0.5"
            max="0.95"
            step="0.05"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Max Uncertainty: {(maxUncertainty * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0.1"
            max="0.5"
            step="0.05"
            value={maxUncertainty}
            onChange={(e) => setMaxUncertainty(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requireCitations}
            onChange={(e) => setRequireCitations(e.target.checked)}
            className="rounded"
          />
          <span className="font-medium text-gray-700">Require Citations (min 2)</span>
        </label>
      </div>

      {result && (
        <>
          <div className={`p-4 rounded mb-4 ${result.passed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`text-2xl ${result.passed ? 'text-green-600' : 'text-red-600'}`}>
                  {result.passed ? '✓' : '✗'}
                </span>
                <span className={`font-semibold ${result.passed ? 'text-green-700' : 'text-red-700'}`}>
                  {result.passed ? 'PASSED' : 'REQUIRES HUMAN REVIEW'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-3">
              <div className="text-center p-2 bg-white rounded">
                <div className="text-lg font-bold" style={{ color: result.confidenceScore >= minConfidence ? '#16a34a' : '#dc2626' }}>
                  {(result.confidenceScore * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">Confidence</div>
              </div>
              <div className="text-center p-2 bg-white rounded">
                <div className="text-lg font-bold" style={{ color: result.uncertaintyScore <= maxUncertainty ? '#16a34a' : '#dc2626' }}>
                  {(result.uncertaintyScore * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">Uncertainty</div>
              </div>
              <div className="text-center p-2 bg-white rounded">
                <div className="text-lg font-bold text-blue-600">
                  {(result.qualityScore * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">Quality</div>
              </div>
            </div>

            {result.reasons.length > 0 && (
              <div className="text-sm">
                {result.reasons.map((r, i) => (
                  <div key={i} className={result.passed ? 'text-green-700' : 'text-red-700'}>• {r}</div>
                ))}
              </div>
            )}
          </div>

          {result.markers.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Uncertainty Markers ({result.markers.length})
              </label>
              <div className="flex flex-wrap gap-2">
                {result.markers.map((m, i) => (
                  <span
                    key={i}
                    className={`px-2 py-1 rounded text-xs font-medium ${categoryColors[m.category] || 'bg-gray-100'}`}
                  >
                    "{m.text}" ({m.category})
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// AUDIT LOG DEMO
// ============================================================================

function AuditLogDemo() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  const addLog = (action: string, level: 'info' | 'warn' | 'error', message: string) => {
    const entry = createAuditLog(action, level, message, {
      userId: 'demo_user',
      model: 'gpt-4o-mini',
      requestId: `req_${Math.random().toString(36).slice(2, 8)}`,
    });
    setLogs(prev => [entry, ...prev].slice(0, 10));
  };

  const levelColors = {
    info: 'bg-blue-100 text-blue-800',
    warn: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <span className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">📋</span>
        Audit Logger
      </h2>
      <p className="text-gray-600 text-sm mb-4">
        Structured, immutable logging with integrity hashing for compliance requirements.
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => addLog('llm.request', 'info', 'LLM request initiated for model gpt-4o-mini')}
          className="px-3 py-2 bg-blue-100 text-blue-700 rounded text-sm font-medium hover:bg-blue-200"
        >
          Log Request
        </button>
        <button
          onClick={() => addLog('llm.response', 'info', 'LLM response completed in 1250ms')}
          className="px-3 py-2 bg-green-100 text-green-700 rounded text-sm font-medium hover:bg-green-200"
        >
          Log Response
        </button>
        <button
          onClick={() => addLog('governance.cost_exceeded', 'warn', 'Request blocked: budget exceeded')}
          className="px-3 py-2 bg-yellow-100 text-yellow-700 rounded text-sm font-medium hover:bg-yellow-200"
        >
          Log Warning
        </button>
        <button
          onClick={() => addLog('llm.error', 'error', 'API error: rate limit exceeded')}
          className="px-3 py-2 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200"
        >
          Log Error
        </button>
        <button
          onClick={() => setLogs([])}
          className="px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200"
        >
          Clear
        </button>
      </div>

      <div className="border rounded overflow-hidden">
        <div className="bg-gray-800 text-gray-100 px-3 py-2 text-xs font-mono flex gap-4">
          <span className="w-24">Time</span>
          <span className="w-16">Level</span>
          <span className="flex-1">Message</span>
          <span className="w-20">Hash</span>
        </div>
        <div className="max-h-64 overflow-y-auto bg-gray-900">
          {logs.length === 0 ? (
            <div className="px-3 py-4 text-gray-500 text-sm text-center">
              Click buttons above to generate audit logs
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="px-3 py-2 text-xs font-mono border-b border-gray-800 flex gap-4 text-gray-300">
                <span className="w-24 text-gray-500">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className={`w-16 px-1 rounded text-center ${levelColors[log.level]}`}>
                  {log.level.toUpperCase()}
                </span>
                <span className="flex-1 truncate">{log.message}</span>
                <span className="w-20 text-gray-600">{log.integrityHash}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {logs.length > 0 && (
        <div className="mt-4 p-3 bg-gray-50 rounded text-xs font-mono overflow-x-auto">
          <div className="text-gray-500 mb-1">Latest Entry (JSON):</div>
          <pre className="text-gray-700">{JSON.stringify(logs[0], null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Enterprise LLM Governance Demo
              </h1>
              <p className="text-gray-600 mt-1">
                Production-grade controls for regulated environments
              </p>
            </div>
            <div className="flex gap-3">
              <a
                href="https://github.com/cmangun/enterprise-llm-integration"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                View on GitHub
              </a>
              <a
                href="https://healthcare-ai-consultant.com"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                Portfolio
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Badges */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">HIPAA Compliant</span>
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">SOC2 Ready</span>
          <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">FDA 21 CFR Part 11</span>
          <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-medium">67 Tests Passing</span>
          <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-medium">TypeScript</span>
        </div>
      </div>

      {/* Demo Grid */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid md:grid-cols-2 gap-6">
          <CostGuardDemo />
          <PIIDetectorDemo />
          <ConfidenceGateDemo />
          <AuditLogDemo />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>
              Built by <a href="https://healthcare-ai-consultant.com" className="text-blue-600 hover:underline">Christopher Mangun</a> • 
              Forward Deployed Engineer
            </div>
            <div className="flex gap-4">
              <a href="https://github.com/cmangun" className="hover:text-gray-900">GitHub</a>
              <a href="https://linkedin.com/in/cmangun" className="hover:text-gray-900">LinkedIn</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
