'use strict';

const contra = require('contra');
const mailgunjs = require('mailgun-js');
const addrs = require('email-addresses');
const inlineCss = require('inline-css');
const { htmlToText } = require('html-to-text');
const noKey = 'campaign-mailgun: API key not set';

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
    const provider = model.provider || {};
    const providerTags = provider.tags || [];
    const merge = provider.merge || {};
    const domain = addrs.parseOneAddress(model.from).domain;
    const authority = model.authority || options.authority
    const client = mailgunjs({
      apiKey: options.apiKey,
      domain: domain
    });

    contra.concurrent({
      html: inlineHtml,
      images: getImages,
      attachments: getAttachments,
    }, ready);

    function inlineHtml (next) {
      const config = {
        url: authority
      };
      inlineCss(model.html, config)
        .then(function inlined (html) { next(null, html); })
        .catch(function failed (err) { next(err); });
    }

    function getImages (next) {
      const images = model.images ? model.images : [];
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

    function getAttachments (next) {
      const attachments = model.attachments ? model.attachments : [];
      next(null, attachments.map(transform));
      function transform (attachment) {
        return new client.Attachment({
          data: attachment.file,
          filename: attachment.name
        });
      }
    }

    function ready (err, result) {
      if (err) {
        done(err); return;
      }
      post(result.html, result.images, result.attachments);
    }

    function post (html, images, attachments) {
      const inferConfig = {
        wordwrap: 130,
        tags: {
          'a': {
            options: {
              baseUrl: authority,
              hideLinkHrefIfSameAsText:true
            }
          },
          'img': {
            options: {
              baseUrl: authority
            }
          }
        }
      };
      const inferredText = htmlToText(html, inferConfig);
      const tags = [model._template].concat(providerTags);
      const batches = getRecipientBatches();
      expandWildcard(model.to, model.cc, model.bcc);
      contra.each(batches, 4, postBatch, responses);

      function postBatch (batch, next) {
        const req = {
          from: model.from,
          to: batch,
          cc: model.cc,
          bcc: model.bcc,
          subject: model.subject,
          html: html,
          text: inferredText,
          inline: images.slice(),
          attachment: attachments.slice(),
          'o:tag': tags.slice(),
          'o:tracking': true,
          'o:tracking-clicks': true,
          'o:tracking-opens': true,
          'recipient-variables': parseMergeVariables(batch, model.cc, model.bcc)
        };
        if (model.replyTo) {
          req["h:Reply-To"] = model.replyTo;
        }

        client.messages().send(req, next);
      }
      function responses (err, results) {
        done(err, results);
      }
    }
    function getRecipientBatches () {
      const size = 250; // "Note: The maximum number of recipients allowed for Batch Sending is 1,000."
      const batches = [];
      for (let i = 0; i < model.to.length; i += size) {
        batches.push(model.to.slice(i, i + size));
      }
      return batches;
    }
    function parseMergeVariables (to, cc, bcc) {
      const variables = {};
      to
        .concat(cc)
        .concat(bcc)
        .forEach(addVariables);
      return variables;
      function addVariables (recipient) {
        if (merge[recipient]) {
          variables[recipient] = merge[recipient];
        }
      }
    }
    function expandWildcard (to, cc, bcc) {
      if ('*' in merge) {
        wildcarding();
      }
      function wildcarding () {
        const wildcard = merge['*'];
        to
          .concat(cc)
          .concat(bcc)
          .forEach(addWildcardToRecipient);
        function addWildcardToRecipient (recipient) {
          Object.keys(wildcard).forEach(addWildcardKeyToRecipient);
          function addWildcardKeyToRecipient (key) {
            // don't override: wildcard has default values
            if (!merge[recipient]) {
              merge[recipient] = {};
            }
            if (!merge[recipient].hasOwnProperty(key)) {
              merge[recipient][key] = wildcard[key];
            }
          }
        }
      }
    }
  }
}

module.exports = mailgun;
