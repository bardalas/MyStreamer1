exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  try {
    const data = JSON.parse(event.body || "{}");

    // Honeypot: accept silently, but do not create an issue.
    if (data.website) {
      return response(200, { ok: true });
    }

    const type = data.type === "feature" ? "feature" : "bug";
    const area = clean(data.area, 100);
    const device = clean(data.device, 100);
    const summary = clean(data.summary, 120);
    const details = clean(data.details, 2500);
    const contact = clean(data.contact, 150);

    if (!area || !device || !summary) {
      return response(400, { error: "Missing required fields" });
    }

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      console.error("Missing Netlify environment variables");
      return response(500, { error: "Server configuration error" });
    }

    const prefix = type === "bug" ? "[User Report] [Bug]" : "[User Report] [Feature]";

    const issueBody = [
      "### Source",
      "Public feedback form",
      "",
      "### Type",
      type === "bug" ? "Bug report" : "Feature request",
      "",
      "### Area",
      area,
      "",
      "### Device",
      device,
      "",
      "### Summary",
      summary,
      "",
      details ? `### Details\n${details}\n` : "",
      contact ? `### Contact\n${contact}\n` : "",
      "---",
      "Submitted from the public VEO feedback form."
    ].filter(Boolean).join("\n");

    const labels = [];
    const label =
      type === "bug"
        ? clean(process.env.BUG_LABEL, 80)
        : clean(process.env.FEATURE_LABEL, 80);

    if (label) labels.push(label);

    const ghResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "veo-feedback-netlify",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: `${prefix} [${area}] ${summary}`,
          body: issueBody,
          labels
        })
      }
    );

    const result = await ghResponse.json();

    if (!ghResponse.ok) {
      console.error("GitHub API error:", ghResponse.status, result);
      return response(502, { error: "Could not create GitHub issue" });
    }

    return response(201, {
      ok: true,
      issueNumber: result.number
    });

  } catch (err) {
    console.error(err);
    return response(500, { error: "Server error" });
  }
};

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
