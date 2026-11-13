CREATE CONSTRAINT artist_discogs_id IF NOT EXISTS
FOR (n:Artist) REQUIRE n.discogsId IS UNIQUE;

CREATE CONSTRAINT label_discogs_id IF NOT EXISTS
FOR (n:Label) REQUIRE n.discogsId IS UNIQUE;

CREATE CONSTRAINT release_discogs_id IF NOT EXISTS
FOR (n:Release) REQUIRE n.discogsId IS UNIQUE;

CREATE FULLTEXT INDEX artistSearch IF NOT EXISTS
FOR (n:Artist) ON EACH [n.name, n.realname, n.nameVariations];

CREATE FULLTEXT INDEX labelSearch IF NOT EXISTS
FOR (n:Label) ON EACH [n.name];

CREATE FULLTEXT INDEX releaseSearch IF NOT EXISTS
FOR (n:Release) ON EACH [n.title];
