# DrawPro

DrawPro is a free online diagramming application and flowchart maker based on [draw.io](https://github.com/jgraph/drawio) (Apache License 2.0).

## Attribution

This software includes code from draw.io, which is licensed under the Apache License 2.0.

- Original draw.io: https://github.com/jgraph/drawio
- License: Apache-2.0
- Copyright (c) 2006-2026, JGraph Ltd / draw.io AG

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Features

- Full draw.io editor functionality (shapes, connectors, formatting, templates)
- Cloud storage with Supabase
- Real-time collaboration
- Share diagrams via links
- AI-powered flowchart generation (NVIDIA NIM)
- Export: PNG, SVG, PDF, Mermaid, JSON

## Deployment

Deployed on Vercel at [drawpro.vercel.app](https://drawpro.vercel.app)

## Development

This is a static site - open `index.html` in a browser or serve with any static file server.

```bash
npx serve .
```

## Credits

- [draw.io](https://github.com/jgraph/drawio) - Core editor engine
- [Supabase](https://supabase.com) - Backend (Auth, Database, Realtime)
- [NVIDIA NIM](https://www.nvidia.com/en-us/ai-data-science/generative-ai/nim/) - AI generation
- [Vercel](https://vercel.com) - Hosting