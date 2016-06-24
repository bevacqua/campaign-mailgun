'use strict';

var contra = require('contra');
var mailgunjs = require('mailgun-js');
var addrs = require('email-addresses');
var inlineCss = require('inline-css');
var htmlToText = require('html-to-text');
var noKey = 'campaign-mailgun: API key not set';

function mailgun (options) {
  if (!options) {
    options = {};
  }
  if (!options.apiKey) {
    warnNoKey();
    return {
      name: 'mailgun',
      send: sendNoKey
    };
  }
  return {
    name: 'mailgun',
    tweakPlaceholder: tweakPlaceholder,
    send: send
  };

  function tweakPlaceholder (property, raw) {
    return '%recipient.' + property + '%';
  }

  function warnNoKey () {
    console.warn(noKey);
  }

  function sendNoKey (model, done) {
    warnNoKey();
    done(new Error(noKey));
  }

  function send (model, done) {
    var merge = model.provider.merge;
    var domain = addrs.parseOneAddress(model.from).domain;
    var client = mailgunjs({
      apiKey: options.apiKey,
      domain: domain
    });

    contra.concurrent({
      html: inlineHtml,
      images: getImages
    }, ready);

    function inlineHtml (next) {
      var config = {
        url: options.authority
      };
      inlineCss(model.html, config)
        .then(function inlined (html) { next(null, html); })
        .catch(function failed (err) { next(err); });
    }

    function getImages (next) {
      var images = model.images ? model.images : [];
      if (model._header) {
        images.unshift({
          name: '_header',
          data: model._header.data,
          mime: model._header.mime
        });
      }
      next(null, images.map(transform));
      function transform (image) {
        return new client.Attachment({
          data: new Buffer(image.data, 'base64'),
          filename: image.name,
          contentType: image.mime
        });
      }
    }
    function ready (err, result) {
      if (err) {
        done(err); return;
      }
      post(result.html, result.images);
    }

    function post (html, images) {
      var inferConfig = {
        wordwrap: 130,
        linkHrefBaseUrl: options.authority,
        hideLinkHrefIfSameAsText: true
      };
      var inferredText = htmlToText.fromString(html, inferConfig);
      var tags = [model._template].concat(model.provider.tags ? model.provider.tags : []);
      var batches = getRecipientBatches();
      expandWildcard();
      contra.each(batches, 4, postBatch, responses);

      function postBatch (batch, next) {
        var req = {
          from: model.from,
          to: batch,
          subject: model.subject,
          html: html,
          text: inferredText,
          inline: images.slice(),
          'o:tag': tags.slice(),
          'o:tracking': true,
          'o:tracking-clicks': true,
          'o:tracking-opens': true,
          'recipient-variables': parseMergeVariables(batch)
        };
        client.messages().send(req, next);
      }
      function responses (err, results) {
        done(err, results);
      }
    }
    function getRecipientBatches () {
      var size = 250; // "Note: The maximum number of recipients allowed for Batch Sending is 1,000."
      var batches = [];
      for (var i = 0; i < model.to.length; i += size) {
        batches.push(model.to.slice(i, i + size));
      }
      return batches;
    }
    function parseMergeVariables (batch) {
      var variables = {};
      batch.forEach(addVariables);
      return variables;
      function addVariables (recipient) {
        if (merge[recipient]) {
          variables[recipient] = merge[recipient];
        }
      }
    }
    function expandWildcard () {
      if ('*' in merge) {
        wildcarding();
      }
      function wildcarding () {
        var wildcard = merge['*'];
        Object.keys(wildcard).forEach(addWildcardToRecipients);
        function addWildcardToRecipients (key) {
          merge.forEach(addWildcardToRecipient);
          function addWildcardToRecipient (recipient) {
            // don't override: wildcard has default values
            if (!recipient.hasOwnProperty(key)) {
              recipient[key] = wildcard[key];
            }
          }
        }
      }
    }
  }
}

module.exports = mailgun;
