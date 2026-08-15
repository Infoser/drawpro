// Injects public env vars into static editor.html at build time.
// Replaces __NEXT_PUBLIC_SUPABASE_URL__ / __NEXT_PUBLIC_SUPABASE_ANON_KEY__
// placeholders in public/editor.html with values from process.env.
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const editorPath = resolve('public/editor.html')

let html = readFileSync(editorPath, 'utf8')

const replacements = {
  __NEXT_PUBLIC_SUPABASE_URL__: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  __NEXT_PUBLIC_SUPABASE_ANON_KEY__: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
}

for (const [placeholder, value] of Object.entries(replacements)) {
  if (value) {
    html = html.split(placeholder).join(value)
  }
}

writeFileSync(editorPath, html)
console.log('[inject-env] public/editor.html updated with build-time env vars')