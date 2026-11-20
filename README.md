# oliverthelyon.github.io

Source for my personal site, <https://OliverTheLyon.github.io/>, built with Jekyll and the [AcademicPages](https://github.com/academicpages/academicpages.github.io) theme and hosted on GitHub Pages.

## Where things live

| To change...                         | Edit...                                             |
|--------------------------------------|-----------------------------------------------------|
| Sidebar details and site settings    | `_config.yml`                                       |
| Top menu                             | `_data/navigation.yml`                              |
| Home page text                       | `_pages/about.md`                                   |
| CV page (education, awards, service) | `_pages/cv.md`, plus the PDF at `files/CV.pdf`      |
| Published papers and theses          | one file per item in `_publications/`               |
| Submitted / in-preparation papers    | `_data/manuscripts.yml`                             |
| Talks and posters                    | one file per item in `_talks/`                      |
| Map on the talks page                | `talkmap/org-locations.js`                          |
| Courses taught                       | one file per course in `_teaching/`                 |
| Game of Life on the home page        | `assets/mips/GameOfLife.asm` (the program; `FinalCombinedCode.asm` is the 2016 original), `assets/js/mips-sim.js` (assembler and interpreter), `assets/js/mips-player.js` and `_includes/mips-player.html` (the panel) |

## Preview locally

```
bundle install
bundle exec jekyll serve
```
