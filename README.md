# Dance information systems

A graph-based exploration tool for electronic music. It maps and visualizes the networks connecting artists, labels, and releases. It currently uses Discogs data as the source.

**Explore** mode starts from one or more seed nodes and lists related artists, labels, or releases. A row ranks higher when it shares more connections with the seeds (the shared links and reasoning for the similarity score are explained clearly). The same neighborhood is drawn as a graph.

**Pathfinder** mode starts from two entities and finds a route between them (the shortest one, or a longer random-ish one). Releases along the route become a playlist for that path.

## Running

You need Node, pnpm, and Docker.

The first time, install dependencies and copy the env file. The defaults match the Neo4j user started by Compose.

```bash
pnpm install
cp .env.example .env
```

Start the database and load a catalog, described in the two sections below. Pathfinder plays a Discogs YouTube URL when a release has one, and otherwise searches YouTube with [yt-dlp](https://github.com/yt-dlp/yt-dlp). Install it so the `yt-dlp` command is on your `PATH`:

```bash
brew install yt-dlp
```

Search hits are cached in `.cache/youtube-search.json`. If search starts failing, upgrade yt-dlp. This is for personal, local use.

Cover images come from the Discogs API when a detail panel opens. Set `DISCOGS_TOKEN` in `.env` if you want them, however, the app runs without a token (just no images).

After the first setup, each session is:

```bash
docker compose up -d
pnpm dev:api
pnpm dev:web
```

- Site: http://localhost:5173
- API: http://127.0.0.1:8787
- Neo4j Browser: http://localhost:7474 (`neo4j` / `discogs-graph`)

The API and the site each stay running in their own terminal. Neo4j stays up in the background. The API reads `NEO4J_URI` from `.env`, which defaults to `bolt://localhost:7687`.

`pnpm explore Workshop` is optional. It prints the same related lists in the terminal.

## Neo4j

`docker compose up -d` starts Neo4j 5 and stores the graph in a Docker volume, so the data is still there the next time you start it. Bolt is published on port 7687 and Browser on port 7474. The user is `neo4j` and the password is `discogs-graph`.

The volume starts empty, so load a catalog before you expect search to return anything. Compose needs ports 7474 and 7687 free.

## Loading a catalog

A small fixture is enough to check that the app is wired up:

```bash
pnpm ingest --fixture
```

For a real monthly dump, follow [data/README.md](data/README.md). Once the three gzip files for one month are in `data/`:

```bash
pnpm ingest --data data
```

Ingest connects to whatever is listening on port 7687 and replaces the graph in that database. It keeps electronic releases whose styles are listed in `config/styles.txt`, plus releases on a label in `config/seed-labels.txt`. Artists and labels are loaded from their own dumps, so aliases and sublabels exist even when no kept release mentions them.

Run ingest again when you want to replace the catalog.
