# jano-plugin-python

Python syntax highlighting plugin for [jano editor](https://janoeditor.dev).

## Features

- Keywords, including `match` / `case` and `async` / `await`
- Strings with prefixes (`f"..."`, `r"..."`, `b"..."`), triple quoted docstrings across lines
- Comments, numbers (hex, binary, octal, separators, complex `3j`)
- Function and class names, method calls, properties, `self` / `cls`
- Builtins (`print`, `len`, `range`, ...), constants (`True`, `None`, `MAX_SIZE`), decorators
- Auto-indent on Enter after `:`, one level less after `return`, `pass`, `break`, `continue`, `raise`

## Install

```bash
jano plugin install python
```

## Supported Files

- `.py`, `.pyi`, `.pyw`

## License

MIT
