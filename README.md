# Dance information systems

A local explorer for how artists, labels, and releases connect in Discogs. Similarity is a count of shared neighbors, with the bridges written out on each row.

The graph lives in **Neo4j**, not in Postgres or a file the API reads directly. Search, related lists, and Path finder are Cypher over that database.

## Daily run (this machine)

The Discogs dump was ingested into the **bundled** Neo4j under `.tools/`, about 18GB at `.tools/root/var/lib/neo4j/data`. Do not use Docker for that copy. Do not ingest again unless you mean to rebuild the graph.

Three processes, three terminals:

```bash
.tools/start-neo4j.sh
pnpm dev:api
pnpm dev:web
```

- Site: http://localhost:5173
- API: http://127.0.0.1:8787
- Neo4j Browser: http://localhost:7474 (`neo4j` / `discogs-graph`)

Leave the Neo4j and API terminals open. `.env` points the API at `bolt://localhost:7687`.

`pnpm explore Workshop` is optional: a CLI print of the same related lists, not a required start step.

## Docker (empty database)

`docker compose up -d` starts a **different** Neo4j with its own empty Docker volume. The README used to lead with that because it is how you would stand up a laptop that has no graph yet (`pnpm ingest --fixture` or `pnpm ingest --data data`). It is not how this checkout’s catalog is stored. Running Compose here does not see the 18GB under `.tools/`. Do not run Compose and `.tools/start-neo4j.sh` at the same time (both want port 7687).

## A real dump

Download instructions live in [data/README.md](data/README.md). `pnpm ingest --data data` writes into whichever Neo4j is listening on 7687 and replaces that graph.
