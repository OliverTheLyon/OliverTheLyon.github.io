---
permalink: /
title: "About"
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---
Hello, my name is Oliver A.S. Lyon. I am a PhD candidate in Biochemistry and Molecular Biology at the University of Calgary, working in the [de Koning lab](http://lab.jasondk.io/).

## My work and research

My areas of interest are primarily focused on how errors propagate, and what we can do with that information. Although that is an abstract description, a more direct one is that my primary PhD work is on developing new [phylogenetic analysis tools](https://github.com/dekoning-lab). In phylogenetics, errors take the form of mutations; we model the evolutionary pressures on new mutations to better understand molecular evolution. My current projects include mutation–selection codon models with stochastic tunneling for multi-nucleotide substitutions, the detectability of episodic shifts in fitness over time, and efficient power analysis for phylogenetic likelihood ratio tests.

In another vein, I also study [laboratory quality control schema](/publication/2023-01-04-2). Errors in laboratory medicine have a rippling effect within healthcare. The clinical laboratory provides a peek under the hood for clinicians to examine the current state of a patient's pathophysiology. Errors in clinical results are at best ignored by clinicians, but at worst are misleading during diagnosis, monitoring, and screening.

You can find the full list on the [publications](/publications/) page, my posters and talks on the [talks](/talks/) page, and everything else in my [CV](/cv/).

## My background and history

I received my undergraduate degree in computer science, with a minor in mathematics, from the [University of Saskatchewan](https://www.usask.ca/) in 2019. During my time at USask, I worked in the [numerical simulation laboratory](https://simlab.usask.ca/), where I developed new numerical analysis tools for solving complex PDE problems. By the time I left USask I was working in the [bioinformatics laboratory](https://www.cs.usask.ca/research/research-labs/the-bioinformatics-lab.php), developing algorithms for identifying and characterizing repeating structures. I then did my master's degree in computer science at [Queen’s University](https://www.queensu.ca/) under [Kai Salomaa](https://research.cs.queensu.ca/home/ksalomaa/afl.htm), finishing in 2021. My research was focused on the computational power of PCR (polymerase chain reaction); to accomplish this I worked to narrow the bounds on the state complexity of PCR-based automata. ... The story continues.

## Conway's Game of Life, in MIPS

This started as a school project in a systems programming class I took in 2016: Conway's Game of Life written in MIPS assembly for the [MARS simulator](https://dpetersanderson.github.io/). The page assembles the source and runs it instruction by instruction in a small MIPS interpreter, drawing to a 32 × 32 bitmap display just as MARS would. Turn the run speed down, or pause and step, to watch each instruction execute. The program running here is a cleaned-up rewrite that needs about an eighth of the instructions per generation; the original is linked below it.

{% include mips-player.html %}
