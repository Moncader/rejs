# rejs [![NPM Version](http://img.shields.io/npm/v/rejs.svg)](https://www.npmjs.org/package/rejs) [![LICENSE](http://img.shields.io/npm/l/rejs.svg)](https://github.com/Moncader/rejs/blob/master/LICENSE)

> A Vanilla JS Module Builder.
```
           _
 _ __ ___ (_)___
| '__/ _ \| / __|
| | |  __/| \__ \
|_|  \___|/ |___/
         |__/
```

## What does rejs do?
rejs resolves JavaScript file order for you to create single JavaScript files from multiple sources without any dependency lookup errors.
![resolve_file_order](/img/resolve_file_order.jpg)

## Install
With npm do:
```
npm install -g rejs
```

## Usage
```
Usage:
    rejs [options] [file ...]

Examples:
    rejs foo.js bar.js baz.js
    rejs --out out.js foo.js bar.js baz.js

Options:
  -h, --help     Print this message
  -o, --out      Output to single file
  -v, --version  Print rejs version
```

## Contributing
1. Fork it
2. Create your feature branch (git checkout -b my-new-feature)
3. Commit your changes (git commit -am 'Added some feature')
4. Push to the branch (git push origin my-new-feature)
5. Create new Pull Request
