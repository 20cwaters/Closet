# Closet

A self-hosted wardrobe app for your household: photograph your clothes, build and save
outfits, and get a daily outfit suggestion based on the weather and what you've worn
recently. It runs in Docker on any always-on machine (a home server, a NAS, a Raspberry Pi
with enough memory) and is meant to be reached on your home network.

- **A tablet in the closet:** browse, build outfits, see today's pick. Returns to the
  profiles screen after 90 idle seconds.
- **Phones:** take photos and add clothes. Remembers who you are.
- **Everyone gets a profile:** add as many people as you like; each has their own closet,
  outfits and daily pick, and pieces can be shared between closets.

There are no passwords: anyone who can reach the app can use every profile. Keep it on
your home network (or behind something like Tailscale), not on the open internet.

## Quick start

You need Docker with Compose, and about 3 GB of free memory for background removal.

```sh
git clone https://github.com/20cwaters/Closet.git closet
cd closet
cp .env.example .env        # then set LAT, LON and TZ (see below)
docker compose up -d --build
```

Open **http://<server-ip>:8530** (or whatever `PORT` you set). On first visit Closet asks
for your name and shows a short tour; replay it any time from your avatar menu
(**How Closet works**).

The first photo you add downloads the background-removal model (~170 MB, once, kept in
`data/models`). rembg also takes about a minute to start after a restart. Uploads made in
the meantime wait and retry on their own.

## People

- **Add someone:** on the profiles screen, tap **Add person**. (On a phone, open your avatar
  menu and tap **Profiles** to get there.)
- **Rename, change photo, remove:** tap your avatar. **Remove** deletes that person's
  pieces, outfits, wear history and plans for good, after a confirmation.
- **Switch person:** tap your avatar, then **Switch to …** or **Profiles**.

Each person's address is their name, e.g. `http://<server-ip>:8530/sam/build`, so a phone
can bookmark its owner's closet.

## Settings (`.env`)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8530` | Port the app listens on. |
| `LAT`, `LON` | New York City | Where to get the weather for (decimal degrees). |
| `TZ` | container default (UTC) | Timezone for "today" (wear log, daily pick), e.g. `Europe/London`. |
| `IDLE_TIMEOUT_SECONDS` | `90` | Large screens return to the profiles screen after this long untouched. `0` turns it off. |
| `REMBG_URL` | `http://rembg:7000` | Background removal service (the `rembg` container). |
| `REMBG_MODEL` | `isnet-general-use` | rembg model. `u2net` is ~2x faster but leaves softer edges. rembg's own default, `bria-rmbg`, needs much more memory. |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` | empty | Optional music player; see **Music (Spotify)**. |
| `OPENROUTER_API_KEY`, `AI_MODEL`, `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` | empty | Optional AI product shots; see **Make it perfect**. |

Apply changes with `docker compose up -d`.

## Taking photos

Lay each piece flat on a plain background, one piece per photo. For white pieces, or
anything with big white prints or logos, use a colored background. White on white is the
one thing background removal struggles with. You can select dozens of photos at once.
Tag them while they upload; the cutouts arrive in the background (~5–8 s each).

Get close, so the piece fills most of the frame: the cutout is cropped from the photo, so
a piece shot from across the room comes out small and soft. Dark pieces look best in bright,
warm light (a window in daytime) on a light grey background rather than bright white, which
makes the camera darken them until the fabric texture is lost.

If a background can't be removed, the piece keeps its original photo. Open it and tap
**Try again** once rembg is back.

### Make it perfect (optional, AI)

With an API key set, every new piece (and every retake) automatically gets an AI version
after its background is removed, and shows it once ready. The detail view's **Make it
perfect** does the same by hand: an image model (Seedream 5.0 Flash, through OpenRouter)
redraws it as a clean, flat, evenly lit product photo, which then has its background removed
like any other. It takes about 30 s and costs about 2¢. Your photo is kept: **Your photo /
Perfect** switches which one the closet shows, and **Redo it** tries again. AI versions can
invent small details (a label, a slightly different shade), so check pieces with logos or
prints. Retaking the photo drops the AI version. Photos are sent to the AI provider, so
leave this off if you'd rather they stay on your machine.

Seedream's filter refuses some prints, usually well-known characters. With `OPENAI_API_KEY`
set, those pieces automatically go to OpenAI's image model instead (`OPENAI_IMAGE_MODEL`,
about 2¢ each too, though its filter refuses some as well).

To turn it on, create a key at [openrouter.ai](https://openrouter.ai) (Settings → API Keys,
with a few dollars of credit) and set `OPENROUTER_API_KEY` in `.env`, then
`docker compose up -d app`. To make AI versions for every piece that hasn't got one
(one at a time; stops if the credits run out):

```sh
docker compose run --rm --no-deps -T app node dist/enhance.js        # or: … enhance.js 12 40
```

After the cutout code changes, redo every piece's cutout from its original (safe while the
app is in use; each piece keeps its old cutout until the new one is ready, ~7 s per piece):

```sh
docker compose run --rm --no-deps -T app node dist/reprocess.js        # or: … reprocess.js 12 40
```

## Tags

Every piece can have any number of each kind of tag:

- **Category:** headwear, outerwear, top, bottom, shoes. An overshirt can be both a top
  and outerwear; it then shows in both Build rows and both Closet sections.
- **Weather:** hot, warm, cool, cold, rainy, windy. **All weather** sets the lot. A piece
  with no weather tags counts as fine in any weather.
- **Style:** Casual, Work, Dressy, Athletic, Lounge, Outdoor, plus any you add with
  **Add style** in the picker. The Closet can filter by style.

A piece's detail view edits its tags, and **Retake photo** swaps in a new photo while
keeping its tags and outfits. **Share** makes a piece show up in everyone's closet.

## Layers

The Tops and Outerwear rows in Build have **+ Layer**, for up to 3 of each (a tee under a
shirt, a vest under a coat). Saved outfits remember which row each piece was in, so they
reopen layered.

## The daily suggestion

All the rules live in **`server/src/rules.ts`**:

- **Recency:** a top worn in the last 5 days, or bottoms in the last 3, are skipped.
  Shoes, outerwear and headwear can repeat.
- **Today's weather:** the high sets the temperature: cold (< 45 °F), cool (< 65 °F),
  warm (< 80 °F) or hot. Rain over 50 % adds *rainy*; wind over 20 mph adds *windy*.
  Pieces tagged with temperatures are only picked on those days. On rainy or windy days,
  pieces tagged for it are picked first.
- **Outerwear:** shown when the high is below 60 °F, or it's rainy or windy.

An outfit planned for today on the calendar wins. Otherwise a saved outfit where every
piece fits is preferred, favoring the least recently worn; failing that, one is assembled
piece by piece. The pick is the same all day (seeded by person and date), and **Shuffle**
gives an alternative that suits today's temperature.

After editing `rules.ts`, run `docker compose up -d --build app`.

## Music (Spotify)

A slim "now playing" strip on Build, with play, pause and skip. Tap it to pick a speaker
(any Spotify Connect device: a phone, a smart speaker) and a playlist. Star a playlist to
make it your **morning playlist**: when nothing is playing, the strip starts it in one tap.
Each person connects their own Spotify from their avatar menu, and each needs Premium.

**One-time setup** (Spotify only allows this for the account owner):

1. Go to <https://developer.spotify.com/dashboard> and **Create app**:
   - Name: Closet. Description: anything.
   - Redirect URI: `https://<your-closet-address>/api/spotify/callback` (it must be HTTPS;
     see **HTTPS** below).
   - API used: **Web API**.
2. In the app's **User Management**, add the Spotify account of everyone else who'll use
   it. Development Mode allows up to 5 people; the app owner needs Premium.
3. In **Settings**, copy the Client ID and Client secret into `.env`
   (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`), set `SPOTIFY_REDIRECT_URI` to the same
   redirect URI, then run `docker compose up -d`.
4. Each person: open Closet at its HTTPS address, tap your avatar, then **Connect
   Spotify**. After that the connection is stored on the server, so any screen, including
   a shared tablet, shows the player.

Speakers only appear while Spotify is open (or recently used) on them. If none show,
open Spotify on the phone or speaker and tap **Refresh**. Tokens refresh on their own; if
someone revokes access in their Spotify account, Closet shows **Connect Spotify** again.
Disconnecting from the avatar menu forgets the tokens. Note that backups include the
stored tokens.

## A local name like `closet.home`

DNS names can't carry a port, so pick one of these:

1. **Your router's or Pi-hole/AdGuard's local DNS.** Add a record `closet.home → <server-ip>`,
   then use `http://closet.home:8530`. (`home.arpa` is the officially reserved suffix for
   home networks; `.home` works with most home DNS too.)
2. **Drop the port with a reverse proxy.** With Caddy, for example:

   ```
   http://closet.home {
       reverse_proxy 127.0.0.1:8530
   }
   ```

3. **One device only:** put `<server-ip>  closet.home` in that device's hosts file.

## HTTPS (optional: needed to install it as an app, keep the screen on, and for Spotify)

Over plain HTTP everything works, but browsers only allow **Install app** (PWA, fullscreen)
and the **screen wake lock** on HTTPS. With HTTPS a tablet keeps its screen on by itself
while the app is open.

- **Tailscale (simplest, no certificates to manage).** If your devices are on a tailnet:

  ```sh
  tailscale serve --bg --https=8443 http://127.0.0.1:8530
  ```

  The app is then at `https://<machine>.<tailnet>.ts.net:8443`, tailnet only. Remove it
  with `tailscale serve --https=8443 off`. **Never** use `tailscale serve` on a port that's
  already a Funnel (`tailscale funnel status` lists them); it turns Funnel off for
  everything on that port.
- **Caddy with its internal CA (LAN only).** Use a `closet.home { tls internal; reverse_proxy 127.0.0.1:8530 }`
  block, then install Caddy's root certificate on the tablet and phones.

Then on the tablet open the HTTPS address and choose **Install app** / **Add to Home
screen**. It opens fullscreen like a kiosk app. A kiosk browser such as Fully Kiosk works
too.

## Backups

`backup.sh` makes a safe online copy of the database with SQLite's `.backup`, checks its
integrity, and snapshots the images folder. Images never change once written, so each
snapshot hard-links unchanged photos to the last one, and a nightly run costs only that
day's new photos. It keeps the newest 14 snapshots by default.

```sh
./backup.sh /path/to/backups/closet        # keep 14
./backup.sh /path/to/backups/closet 30     # keep 30
```

Use a different disk from the app's. Nightly at 03:15, via `crontab -e`:

```cron
15 3 * * * /path/to/closet/backup.sh /path/to/backups/closet >> /path/to/backups/closet/backup.log 2>&1
```

The log path must be somewhere you can write. If cron can't open it, the whole job
silently never runs. Create the folder first: `mkdir -p /path/to/backups/closet`.

### Restore

```sh
cd /path/to/closet
docker compose stop app
cp /path/to/backups/closet/latest/closet.db data/closet.db
rm -f data/closet.db-wal data/closet.db-shm
rsync -a --delete /path/to/backups/closet/latest/images/ data/images/
docker compose start app
```

Use a dated folder instead of `latest` to go back further.

## Running it

- **Status:** `docker compose ps`. The app has a Docker healthcheck on `/api/health`, which
  also reports whether rembg is up.
- **Logs:** `docker compose logs -f app` (or `rembg`).
- **Memory:** rembg holds ~1.7 GB once it has processed a photo, capped at 2.5 GB.
  `docker restart closet-rembg` frees it after a big batch.
- **Data:** `./data` holds `closet.db` and `images/{originals,cutouts,thumbs,outfits,people}`.
  Filenames are random and never reused, so images are served with year-long cache headers.
- **File ownership:** both containers run as user `1000:1000` so `./data` stays owned by
  you. If your user id differs (`id -u`), change `user:` in `docker-compose.yml`.

## Development

With Node 22:

```sh
cd server && npm install && npm run build && npm test     # type-check + suggestion rule tests
cd web && npm install && npx tsc -b                        # type-check the frontend
```

Or without Node on the host, in containers:

```sh
docker run --rm -u 1000:1000 -e HOME=/tmp -v $PWD/web:/w -w /w node:22-bookworm npx tsc -b
docker run --rm -u 1000:1000 -e HOME=/tmp -e DATA_DIR=/tmp/d -v $PWD/server:/w -w /w node:22-bookworm \
  sh -c 'npx tsc -p . && npm test'
docker compose up -d --build app     # rebuild and restart
```

- **Layout:** `server/` holds Express, SQLite migrations in `server/migrations/*.sql`, and
  the image pipeline. `web/` is React + Vite + Tailwind; the design tokens are in
  `web/src/styles/tokens.css`.
- **Schema changes:** add a new numbered `.sql` file to `server/migrations/`. Each runs
  once, in order, with foreign keys off and checked before it commits. Existing data must
  be carried forward; `002_tags_layers.sql` and `007_people.sql` are examples.

## Contributing

Issues and pull requests are welcome. Please keep changes small and focused, run the
type-checks and tests above, and describe how you tried the change in the app.

## License

[MIT](LICENSE)
