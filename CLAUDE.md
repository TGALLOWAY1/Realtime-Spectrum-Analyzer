## Project
Real-Time Frequency Analyzer
## Mission
Turn this app into a portfolio-worthy audio analysis product that demonstrates strong frontend engineering, useful signal-analysis features, polished UX, and clear recruiter/demo value.
This project should feel like a real tool for music production and sound design, not just a chart or DSP experiment.
---
## Primary Goal
Build a polished real-time analyzer that helps users:
- visualize spectral content clearly
- identify peaks/resonances and tonal balance
- understand how the sound evolves over time
- compare live audio to saved snapshots/references
- learn something useful from the analysis
---
## Product Priorities
When making decisions, optimize for these in order:
1. clarity of the user experience
2. usefulness of the analysis
3. stability and responsiveness
4. clean architecture
5. memorable portfolio value
Do not add broad feature sprawl before the core analyzer experience is excellent.
---
## Core V1 Scope
The preferred V1 includes:
### Analyzer
- real-time spectrum visualization
- log frequency axis
- adjustable dB range
- FFT size control
- smoothing control
- peak hold
- freeze/pause
### Insights
- peak/resonance detection
- band energy summary
- spectral centroid / brightness
- simple tonal descriptors
### Time-based view
- spectrogram or rolling history view
- short-term metric history
### Comparison
- save snapshot
- overlay snapshot against live signal
- basic delta view
### Demo polish
- sample/demo audio options
- helpful empty states
- lightweight tooltips / explanatory text
---
## Explicit Non-Goals for Early Versions
Avoid turning this into a DAW, plugin host, or giant audio utility suite.
Do not prioritize:
- accounts/auth
- cloud sync
- social features
- complex collaboration
- excessive theming systems
- exotic DSP features before the core UX is strong
---
## UX Principles
All UI decisions should follow these rules:
### 1. The graph must be readable
- prioritize legibility over visual flair
- labels, axes, and overlays should be easy to parse quickly
- avoid clutter
### 2. Insights should be concise
- do not overwhelm users with walls of analysis text
- show a few useful summaries, warnings, or comparisons
### 3. Controls should feel purposeful
- only expose controls users can understand and benefit from
- advanced controls should have helper text when needed
### 4. The app should demo well
- a recruiter should understand the product quickly
- empty states should teach the product
- sample audio/demo mode is valuable
### 5. Time-based behavior matters
This is a real-time app. Jank, dropped frames, or sluggish interactions are high-priority issues.
---
## Engineering Principles
### Architecture
Prefer separation between:
- audio source/input handling
- FFT / raw analysis pipeline
- derived metrics computation
- visualization rendering
- snapshot/comparison state
Derived metric functions should be as pure and testable as possible.
### State
Keep high-frequency frame data isolated from lower-frequency UI state when possible.
Avoid app-wide rerenders for per-frame updates.
### Performance
Be careful with:
- rerender loops
- unnecessarily large buffers
- history arrays that grow without bounds
- expensive per-frame calculations in React render paths
Use bounded buffers and memoized computations where appropriate.
### Maintainability
Favor:
- small focused utilities
- clear type definitions
- predictable data flow
- stable naming
Avoid hidden coupling between visualization and audio-analysis logic.
---
## Preferred Feature Additions
If asked what to add next, generally prefer these:
1. better analyzer readability
2. band summaries and useful derived metrics
3. snapshot/reference comparison
4. spectrogram/history views
5. stereo or mid-side analysis
6. musical note / harmonic interpretation
7. exportable demo/report features
---
## Portfolio Framing
The project should ultimately support a presentation like:
"Built a real-time audio frequency analysis tool for music production and sound design, featuring FFT-based spectrum visualization, spectrogram history, band-energy insights, snapshot/reference comparison, and resonance detection, with a strong emphasis on responsiveness, readability, and practical workflow value."
Use this framing when making scope decisions: does the feature help tell that story?
---
## Code Quality Expectations
When editing code:
- preserve existing working behavior unless intentionally changing it
- prefer incremental, testable improvements
- do not mix unrelated refactors into one change
- keep new abstractions justified and lightweight
- remove dead or confusing code when safe
If a change improves architecture but risks UI regressions, protect the user experience first.
---
## UI Quality Expectations
Flag and fix:
- overlapping layouts
- unreadable labels
- unclear empty states
- controls without explanation
- inconsistent spacing/hierarchy
- visual clutter
- panels that feel disconnected from the main workflow
---
## Data / Metric Guidelines
For derived analyzer metrics:
- keep formulas understandable
- make thresholds explicit
- prefer stable, interpretable metrics over opaque heuristics
- ensure labels match what the metric actually measures
Examples of good metrics:
- dominant peak frequency
- relative band energy
- spectral centroid
- brightness delta vs reference
- stereo energy distribution by band
---
## Documentation Expectations
Keep docs concise and useful.
Important docs may include:
- README with screenshots/GIFs
- feature roadmap
- architecture notes
- "how it works" overview for FFT/analysis choices
Do not write overly academic documentation unless it helps explain user value or engineering tradeoffs.
---
## Working Style
When implementing or proposing changes:
- think in milestones, not random features
- prefer product-complete slices
- keep the V1 narrow and polished
- suggest tradeoffs when relevant
- call out risks to performance or UX early
---
## Good Change Examples
- improve graph scale readability
- add snapshot overlay with clear labels
- compute and display band summaries
- add bounded spectrogram history buffer
- add empty-state guidance and demo audio
- optimize frame update/render pipeline
## Bad Change Examples
- adding many niche controls before core polish
- large refactors without user-facing benefit
- visually flashy but unreadable charts
- DSP additions that cannot be explained clearly
- unbounded history/performance regressions
---
## Default Decision Rule
When uncertain, choose the option that makes the app:
- easier to understand
- more useful in a real workflow
- smoother in real time
- stronger as a portfolio piece
