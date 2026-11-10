---
'@selvajs/solve': patch
---

A blocked or aborted solve no longer blanks `dynamicValueList` outputs (`blankOutputs` skips them). They hold the options and rows the form is drawn from, so lists and repeated rows stay as they were instead of emptying until the next good solve.
