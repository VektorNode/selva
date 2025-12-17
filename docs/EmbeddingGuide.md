# Embedding Selva Compute App

The Selva Compute App is designed to be easily embedded into other websites, including platforms like Microsoft SharePoint, Notion, or any standard HTML page.

## How it works

All configuration happens via the **URL**. You do not need complex JavaScript on the host page; you just need to construct the correct link.

### URL Structure

```
https://<your-app-url>/<definition-name>?embed=true&<options>
```

- **`definition-name`**: The name of your Grasshopper file (without `.gh`).
- **`embed=true`**: Hides the header and adjusts the layout for embedding.
- **`primary=<color>`**: (Optional) Sets the primary accent color (hex code).
- **`background=<color>`**: (Optional) Sets the background color (hex code).

### Example URLs

**Basic:**

```
https://compute.selva.app/my-definition?embed=true
```

**With Custom Colors (Red primary, White background):**

```
https://compute.selva.app/my-definition?embed=true&primary=%23ff0000&background=%23ffffff
```

_(Note: `%23` is the URL-encoded version of `#`)_

---

## Using with Microsoft "Embed Web Part"

If you are using the [Microsoft Embed Web Part](https://support.microsoft.com/en-us/office/add-content-to-your-page-using-the-embed-web-part-721f3b2f-437f-45ef-ac4e-df29dba74de8), you can usually paste either the direct address or the iframe code.

### Option 1: Website Address

Paste the full URL directly:

```
https://compute.selva.app/selva_example_0_1_0?embed=true
```

### Option 2: Iframe Code

If the platform requires an iframe tag, use this:

```html
<iframe
  src="https://compute.selva.app/selva_example_0_1_0?embed=true&primary=%23000000"
  width="100%"
  height="700"
  frameborder="0"
  allow="fullscreen"
>
</iframe>
```

## Configuration Parameters

| Parameter    | Type      | Description                                                      | Example                 |
| ------------ | --------- | ---------------------------------------------------------------- | ----------------------- |
| `embed`      | `boolean` | Set to `true` to enable embed mode.                              | `?embed=true`           |
| `primary`    | `hex`     | Primary button/accent color. Must be URL encoded (`#` -> `%23`). | `&primary=%23ff0000`    |
| `background` | `hex`     | Page background color.                                           | `&background=%23f5f5f5` |

## Helper Tool

We have included a helper tool in `examples/iframe-embedding.html` that you can open in your browser. It allows you to pick colors visually and automatically generates the correct URL and Iframe code for you to copy-paste.
