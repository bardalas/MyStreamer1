# VEO Feedback - Netlify

## Structure

- index.html
- netlify.toml
- netlify/functions/report.js

## IMPORTANT: where the GitHub token goes

The GitHub token goes in:

Netlify -> Project configuration -> Environment variables

Create these variables:

GITHUB_OWNER = your GitHub username or organization
GITHUB_REPO = the repository where Issues should be created
BUG_LABEL = bug
FEATURE_LABEL = enhancement
GITHUB_TOKEN = your fine-grained GitHub token

DO NOT put GITHUB_TOKEN in index.html.
DO NOT put GITHUB_TOKEN in report.js.
DO NOT commit a .env file with the token.

The Netlify Function reads it server-side using:
process.env.GITHUB_TOKEN

## GitHub token permissions

Use a fine-grained personal access token limited to the target repository.

Repository permissions:
Issues: Read and write

## Netlify deploy

Option A - Git deployment
1. Create a new GitHub repository, e.g. veo-feedback
2. Upload all files in this package
3. Netlify -> Add new project -> Import an existing project
4. Select GitHub and choose veo-feedback
5. Build command: leave empty
6. Publish directory: .
7. Deploy
8. Add the environment variables
9. Trigger a new deploy

Option B - drag and drop

Static drag-and-drop alone is not recommended here because the project uses a Netlify Function.
Use Git deployment so the function is built and deployed correctly.
