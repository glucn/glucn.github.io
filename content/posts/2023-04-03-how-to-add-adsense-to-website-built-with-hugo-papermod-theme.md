---
title: "How to add Google AdSense to website built with Hugo + PaperMod theme?"
date: 2023-04-03T00:00:00
draft: false
---

## Goal

Add Google AdSense to the website to monetize it 💸💸

## Prerequisites

1. Website built with [Hugo](https://gohugo.io/) and [PaperMod theme](https://github.com/adityatelange/hugo-PaperMod)
2. Google AdSense account

## Steps

1. Add the website to Google AdSense account.
2. [Optional] Config Ads setting in Google AdSense.
3. Get AdSense code snippet, which should be similar to the following:
    ```
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=xxxxxxxxxx"
        crossorigin="anonymous"></script>
    ```
4. Create file `layouts/partials/extend_head.html` in the code of the website, if it doesn't exist.
    - Note: the content of this file will be added to `<head>...</head>` of the page by PaperMod.
5. Paste the AdSense snippet into `layouts/partials/extend_head.html`.
6. Verify the change locally, and deploy it. 
7. Submit review request in Google Adsense, and wait for the processing. 

DONE!