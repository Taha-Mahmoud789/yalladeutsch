# YallaDeutsch

German listening, dictation and shadowing practice with YouTube clips.

## Run locally

Use Node.js 24 and run:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. On Windows, start.bat also starts the development server.

Run npm test for the self-checks, or npm run build and npm start for the production server.

## Deploy to Vercel

Import the repository with the Next.js framework preset and the directory containing package.json as its root. Use the default build and output settings. The caption relay runs at /api/relay on Node.js and requires no environment variables.

Saved clips and progress live in the browser. Use Export and Import under My clips to move data to a different domain or port.
