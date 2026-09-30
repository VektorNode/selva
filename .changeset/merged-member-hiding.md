---
'@selvajs/visualization': patch
---

Fix hiding single objects inside a merged mesh. Hidden members kept drawing because three ignores geometry groups on a single-material mesh, and selecting a member overwrote the hidden ranges. Hiding and selection highlight now compose, hidden members are no longer pickable, their edge overlay segments are dropped, and showing one member of a hidden layer turns the mesh back on.
