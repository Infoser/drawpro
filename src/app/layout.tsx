import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DrawPro - Flowchart Maker & Online Diagram Software',
  description:
    'DrawPro is free online diagram software for making flowcharts, process diagrams, org charts, UML, ER and network diagrams',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}