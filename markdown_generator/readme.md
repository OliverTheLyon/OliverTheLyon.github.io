# Publication markdown generator

`pubsFromBib.py` (and the notebook version, `PubsFromBib.ipynb`) reads the BibTeX files in this folder and writes one markdown file per entry into `../_publications/`.

* `pubs.bib` - journal articles
* `proceedings.bib` - conference papers

To add a paper, add its BibTeX entry to the matching file and run `python pubsFromBib.py` from this folder (requires `pybtex`), or simply copy an existing file in `_publications/` and edit it by hand.
