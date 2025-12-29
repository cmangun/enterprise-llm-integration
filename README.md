# Enterprise LLM Integration

[![CI](https://github.com/cmangun/enterprise-llm-integration/actions/workflows/ci.yml/badge.svg)](https://github.com/cmangun/enterprise-llm-integration/actions/workflows/ci.yml)

Secure, audited adapter patterns for integrating LLMs into enterprise systems.

## Overview

This library provides production-grade patterns for LLM integration in regulated environments:

- **Schema Validation**: Typed request/response with Zod
- **Governance Guardrails**: Cost ceilings, token limits, fail-fast policies
- **Telemetry Hooks**: Request correlation IDs, span tracking for audit trails
- **Retry Policies**: Exponential backoff with jitter for reliability
- **Security**: No secrets in code, audit-ready request logging

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Application                       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Enterprise LLM Adapter                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Schema    │  │ Governance  │  │      Telemetry          │  │
│  │ Validation  │  │   Guard     │  │  (Request ID, Spans)    │  │
│  │   (Zod)     │  │ (Cost Cap)  │  │                         │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                     │                 │
│         └────────────────┼─────────────────────┘                 │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Retry / Backoff Policy                         │ │
│  └─────────────────────────────────┬───────────────────────────┘ │
└────────────────────────────────────┼────────────────────────────┘
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │     LLM Provider API           │
                    │  (OpenAI, Azure, Anthropic)    │
                    └────────────────────────────────┘
```

## Quickstart

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

### Usage

```typescript
import { OpenAIAdapter } from 'enterprise-llm-integration';

const adapter = new OpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  usdCeilingPerRequest: 0.25,  // Governance: max cost per request
  maxRetries: 3,
});

const response = await adapter.chat({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
});

console.log(response.content);
console.log(`Request ID: ${response.requestId}`);  // For audit correlation
console.log(`Tokens used: ${response.usage.totalTokens}`);
```

## Security & Compliance Notes

- **Secrets**: Never committed. Use `.env` files locally, secret managers in production.
- **Request IDs**: Every request gets a unique `X-Request-Id` header for audit correlation.
- **Cost Guards**: Requests exceeding budget are rejected *before* API calls.
- **Telemetry**: Spans include model, tokens, latency for observability.

## API Reference

### OpenAIAdapter

| Method | Description |
|--------|-------------|
| `chat(request)` | Full chat completion with all options |
| `complete(prompt)` | Simple single-turn completion |

### Governance

| Function | Description |
|----------|-------------|
| `assertWithinCostCeiling(input)` | Throws if estimated cost exceeds ceiling |
| `estimateTokens(text)` | Estimate token count from text |
| `estimateCost(model, input, output)` | Calculate cost estimate |

### Telemetry

| Function | Description |
|----------|-------------|
| `newRequestId()` | Generate unique request correlation ID |
| `startSpan(name)` | Begin a telemetry span |
| `endSpan(span)` | Complete span with duration |

## Next Iterations

- [ ] Replace token estimation with tiktoken for accuracy
- [ ] Add OpenTelemetry exporters (OTLP, Jaeger, Prometheus)
- [ ] Add PII redaction hooks with configurable policies
- [ ] Add Azure OpenAI and Anthropic adapters
- [ ] Add deterministic retry classification (429, 5xx, network errors)
- [ ] Add contract tests with recorded provider responses

## License

MIT © Christopher Mangun

---

**Portfolio**: [field-deployed-engineer.vercel.app](https://field-deployed-engineer.vercel.app/)  
**Contact**: Christopher Mangun — Brooklyn, NY
