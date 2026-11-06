# YallaDeutsch design

The reference is [VocaType Video](https://video.vocatype.app/en/), reviewed from a desktop capture on November 6, 2026. The reference uses a cool light background, Quicksand, a centered video, and a compact control strip above the typing area.

YallaDeutsch uses a white workspace, a navy header and player surface, and navy primary controls. Pale blue-gray separates secondary surfaces and highlights selected controls. The listening screen places search above the video and keeps the current word, translation, and B1 discovery in a separate panel. The panel moves below the video on smaller screens. The trainer stacks a centered video, transport and scores, then the exercise and transcript.

The stylesheet lives in src/styles. The Next.js App Router renders React components for the home and trainer. A client bootstrap initializes the browser controllers after hydration. Home owns discovery, the library, and saved clips. Trainer owns playback and practice. Progress owns the review interface and statistics. Core contains exercise logic and the B1 word list, data contains browser persistence, and services contains external integrations. The Node.js caption relay is exposed at /api/relay.
