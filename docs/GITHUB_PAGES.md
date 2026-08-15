# GitHub Pages deployment

The public Rel.AI website is served as the GitHub Pages project site for the `Kyne0328/rel-ai-mcp` repository:

`https://kyne0328.github.io/rel-ai-mcp/`

The website source remains in the separate `Kyne0328/rel-ai-mcp-website` repository. Do not copy the website into this repository. `.github/workflows/pages.yml` checks out the website source and deploys it as a GitHub Pages artifact.

## One-time GitHub setup

1. In `Kyne0328/rel-ai-mcp`, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Create a fine-grained personal access token that can read repository contents from **only** `Kyne0328/rel-ai-mcp-website`.
3. In `Kyne0328/rel-ai-mcp`, open **Settings → Secrets and variables → Actions** and add the token as the repository secret `REL_AI_WEBSITE_READ_TOKEN`.
4. Open **Actions → Deploy Website to GitHub Pages** and run the workflow once. Scheduled runs then check the website source twice per hour and deploy the current `main` branch.

The deployment workflow itself has only `contents: read`, `pages: write`, and `id-token: write` permissions in `rel-ai-mcp`. The cross-repository token is used only by `actions/checkout` to read the private website repository and is not persisted in the checkout.

## Updating the website

Make website changes in `rel-ai-mcp-website`. After those changes reach its `main` branch, the Pages workflow in `rel-ai-mcp` will pick them up on the next scheduled run. Use **Run workflow** when an immediate deployment is needed.

Keep website asset URLs relative so the same source works locally and under the `/rel-ai-mcp/` project path. Do not add a root-relative `/` base path unless the deployment model changes.

## Custom domain

A custom domain is optional. The GitHub project URL remains the default deployment target unless a domain is configured in **Settings → Pages**. Adding a `CNAME` file alone does not configure the Pages custom domain.
