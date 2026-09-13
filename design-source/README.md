# Design source files

Original, uncropped branding artwork provided for the SSP Worldwide and SSP UK & Ireland Dashboard Views. The actual assets the application uses (`public/ssp-worldwide-logo.png`, `public/ssp-uk-ireland-logo.png`, `public/assets/dashboard/*.png`) were cropped/derived from these.

Kept here — outside `public/` — so they stay version-controlled without being copied into the production build (`npm run build` only copies `public/` into `dist/`). Nothing in the application code references files in this folder.
