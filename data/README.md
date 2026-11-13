# Discogs dumps

Monthly dumps are CC0 metadata from [data.discogs.com](https://data.discogs.com/). Put the three gzip files for one month in this folder. The ingest script picks the newest date it finds. It streams the gzip and does not unzip a second copy onto disk.

```bash
cd data
curl -O https://data.discogs.com/data/2026/discogs_20261001_artists.xml.gz
curl -O https://data.discogs.com/data/2026/discogs_20261001_labels.xml.gz
curl -O https://data.discogs.com/data/2026/discogs_20261001_releases.xml.gz
```

Replace `20261001` with the month you want. Checksums sit next to the files as `discogs_YYYYMMDD_CHECKSUM.txt`.

Then, from the repo root:

```bash
pnpm ingest --data data
```

That replaces the local graph. `config/styles.txt` and `config/seed-labels.txt` decide which releases are stored. Artists and labels are loaded from their own dumps so aliases and sublabels exist even before a release mentions them.

Cover files are not in the dump. Image URLs are filled later from the Discogs API when a detail panel opens, using `DISCOGS_TOKEN` in `.env`.
