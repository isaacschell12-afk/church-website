Place the following self-hosted font files in this directory. They are referenced
by the @font-face rules at the top of ../main.css and are served locally so the
site never loads fonts from fonts.googleapis.com (the CSP forbids external fonts).

Required files (download the .woff2 from https://fontsource.org or Google Fonts):

  PlayfairDisplay-Regular.woff2
  PlayfairDisplay-Bold.woff2
  Inter-Regular.woff2
  Inter-Medium.woff2
  Inter-Bold.woff2

Until these files are present the browser falls back to system serif/sans-serif
fonts (declared in the font stacks), so the site still renders correctly.
