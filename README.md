# LOOK BACK

R18 infinite horror collage. Anonymous.

## Run

```bash
cd Development/WrongHouse/web
npm install
npm run build   # production: minified, no sourcemaps, hashed assets
npm run preview
```

Dev: `npm run dev` → `http://127.0.0.1:3947`

## Notes

- Photos/videos capped at **5 appearances** per scroll window
- Strip DOM recycled (max 4 strips); max 2 videos playing
- **UPLOAD** (top-right) queues files in IndexedDB as pending — admin/backend later
- Production build drops console, mangles identifiers, hashed filenames
- No real murder-victim corpse imagery
