# Frame Embedder

### About

This script allows for embedding Farcaster frames to websites. For more information on Farcaster frames, check out https://docs.farcaster.xyz/developers/frames/spec

**RECOMMENDATIONS**:

- To enable frames, make sure to add the frame's target URL to your CSP meta-tag.

**Live Demo**: https://ny-1.frames.sh/v/38875/demo.html

### Required Files

The required files are:

- embedder.css - includes styling for the embedded frames and its components.
- embedder.js - includes the script for processing frame embeds.

### Embedding Frames

To embed frames, add the embedder styles to your header:

```
  <link href="<path>/embedder.css" rel="stylesheet" />
```

add the frame script to the end of your page's body:

```
  <script type="text/javascript" src="embedder.js"></script>
```

and, add your frames to your page, specify a container element and add the follow data:

- **data-frame-fid** - the Farcaster fid to use when the user interacts with the frame
- **data-frame-theme** (default - "dark") - the theme for your frame, "dark" or "light"
- **data-frame-url** - the url of target frame that will be displayed in the container element

**NOTE:** include the "frame-embed" css class to your frame container element.

Please refer to the demo (link above) for a full example of integration.
