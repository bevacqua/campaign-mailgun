# campaign-mailgun

> Mailgun email provider for Campaign

# install

```shell
npm i campaign-mailgun -S
```

# usage

using [`campaign`](https://github.com/bevacqua/campaign).

```js
var campaign = require('campaign');
var mailgun = require('campaign-mailgun');
var client = campaign({
  provider: mailgun({
    apiKey: 'YOUR_API_KEY',
    authority: 'https://example.com'
  })
});
client.send(...) // as usual
```

# `mailgun(options)`

minimal configuration is involved.

## `options.apiKey`

the API key from Mailgun.

## `options.authority`

your domain's origin for relative links.

# license

mit
