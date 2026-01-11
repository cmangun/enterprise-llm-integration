import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Enterprise LLM Governance Demo',
  description: 'Interactive demo of production-grade LLM governance controls',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
