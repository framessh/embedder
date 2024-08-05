# Frame Embedder

### About

This script allows for embedding Farcaster frames to websites. For more information on Farcaster frames, check out https://docs.farcaster.xyz/developers/frames/spec

**RECOMMENDATIONS**:

- To enable frames, make sure to add the Frame Proxy's URL to your CSP meta-tag, a default proxy "https://proxy.frames.sh" is provided and hosted by Frames.sh. See below to learn more about the frame proxy.

```
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src *; frame-src blob: https://proxy.frames.sh; img-src 'self' * data: blob: https://proxy.frames.sh; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';"
  />
```

**Live Demo**: https://ny-1.frames.sh/v/38875/demo.html

**Proxy Server Recommended Configuration:**:

```
  At least 2GB GPU RAM
  At least 8GB CPU RAM
  Sudoer user (not root) - for chromium
```

### Required Files

The required files are:

- **embedder.css** - includes styling for the embedded frames and its components.
- **embedder.js** - includes the script for processing frame embeds.

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

### Frame Events

Events are emitted on:

- **Frame loading** - the event is emitted when the frame is loading
- **Frame rendered** - the event is emitted when the frame is rendered after loading
- **Frame failed render** - the event is emitted when an error occurs during frame rendering or loading
- **Frame button clicked** - the event is emitted when a button is clicked
- **Frame transaction** - the event is emitted when a transaction data is received
- **Frame mint** - the event is emitted when a MINT action is invoked
- **Frame notication popup** - the event is emitted when a notification popup is invoked
- **Frame transaction popup** - the event is emitted when a transaction popup is invoked

The host page can listen to these events and respond accordingly with the data provided in the event. Check the console logs in the demo for examples of the events emitted.

The events data includes:

```
  interface Event {
    type: "Frame loading" | "Frame rendered" | "Frame failed render" | "Frame button clicked" | "Frame transaction" | "Frame mint" | "Popup Notification" | "Popup transaction",
    content: {
      frameId: (string) the data-frame-embedder-id value assigned during frame load
      url: (string) the post url target of the frame
      transaction?: (object) the transaction data structured per the frame specification
      mint: (string) the CAIP-10 data payload for mints
      button?: {
        title: (string) the label text of the button
        interaction: "tx" | "mint" | "link" | "post" | "post_redirect",
        postUrl: (string) the target POST url of the button
        type: (string) the button id i.e. button1, button2, button3
      }
      inputs?: (string) included in "Frame button clicked", "Frame transaction", and "Frame mint" events - these are all the inputs in the current frame encoded (URI encoded JSON string),
      state?: (string) the frame's state (URI encoded JSON string as per frame spec)
    }
  }
```

**Disabling and Enabling Popups**

Popups can be disable and let the parent window handle popups independently. An event will be emitted on these actions. 

Disable or enable the popups using: `disablePopups()` or `enablePopups`

**Enabling Transactions**

Transactions type actions such as mint & tx are supressed by default. When a user clicks on a tx/mint button a notification is displayed noting the unsupported action. To enable transaction actions, add the \*\*data-frame-transactions-enabled flag with the value true to the container element, for example:

```
<div
  data-frame-fid="628548"
  data-frame-transactions-enabled="true"
  data-frame-theme="dark"
  data-frame-url="https://ny-1.frames.sh/v/38871"
  class="frame-embed frames"
></div>
```

**Handling transaction events**

As per the frame spec, the client/host is expected to send an action to the frame when a transaction is sent to the chain. With frame embedder, when a "Frame Transaction" event is emitted, the host is expected to handle the transaction. Once the transaction is sent to the chain the host can invoke a **performAction** call to window.frameEmbedder, for example:

```
  // See the demo on how to capture the frame events
  const frameEventCaptured = frameEvent;

  // Get the frame id
  const frameId = frameEventCapture.content.frameId;

  // No changes required to input
  const frameInputs = frameEventCapture.content.inputs;

  // Get the button index from the button data included in the event
  const buttonIndex = frameEventCapture.content.button.type.replace("button");

  // Get the frame state - no changes required
  const frameState = frameEventCaptured.content.state;

  // Declare the network and sender address of the transaction - provide these details with the details from your modal data
  const [network, address] = [8453, "0x..."];

  // Declare the transaction id
  const transactionId = "0x...";

  // Construct the transaction data
  const transactionData = {
    network,
    address,
    transactionId
  };

  frameEmebdder.performAction(frameId, frameInputs, frameState, buttonIndex, transactionData);
```

### Frame Proxy

To circumvent the CSP issue when loading frames directly from different frame servers, a proxy is used to centralize the provision of frame content including the frame html and image.

The proxy POST payload when performing a POST action to a frame requires the following structure:

```
interface ProxyPayload{
  target: (string) - url of the POST target (the target or post_url of the button clicked),
  payload: frame spec signature pacjet payload object - see https://docs.farcaster.xyz/developers/frames/spec#frame-signature-packet
}
```

The response format is structured like so:

```
interface ProxyResponse{
  content: the html content of the frame
  image: the image url
}
```

The role of the proxy is to relay the payload to the target frame server and deliver the response to the front. In the process, the proxy will parse the frame HTML content and pick the fc:frame:image/of:image url and download the image resource for storage. The image resource should be accessible from the proxy server and used as the value for the image key in ProxyResponse.

A proxy daemon is provided in the /proxy folder. See the Installation & Running section below to learn more on how to get started.

**Changing Default Proxy**

A default proxy server is provided in the script. To change this default to a different server, change the `frameProxy` value in the script.

**Installation & Running**

To run your own instance of the proxy server, deploy the proxy inside the `proxy` folder.

**Requirements:**

- Node 18.x
- SSL Certificates

Populate the SSL files required for the server in the `/ssl` folder. And run the installation script (install.sh).

Configure the environment file with the following:

```
  BASE_URL=<the publicly accessible URL path for the images>
  IMAGE_ID_NAMESPACE=<the UUIDv5 namespace used for generating image IDs>
```

**Install the service:**

```
bash install.sh
```

Edit the working directory in proxy.service to the current directory of the `proxy` folder.

Install the service by running service.sh:

```
bash service.sh
```

**Proxy services:**

The proxy service provides both /public & /index paths for public access. The public path contains the cached images delivered on frame interactions. The public path cache is cleaned every minute, old images are removed.

The index path contains the landing images for frames. The images are accessible based on the frame's target URL. To access the frame images, encode the frame target URL in the path i.e. `https://proxy.frames.sh/index/https%3A%2F%2Fny-1.frames.sh%2Fv%2F38873`
