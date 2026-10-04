import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

const GRAPHQL_QUERY = `
  query GetPinnedAndFeaturedRepositories($login: String!, $searchQuery: String!) {
    user(login: $login) {
      pinnedItems(first: 6, types: [REPOSITORY]) {
        nodes {
          ... on Repository {
            id
            name
            description
            url
          }
        }
      }
    }
    search(query: $searchQuery, type: REPOSITORY, first: 10) {
      nodes {
        ... on Repository {
          id
          name
          description
          url
          pushedAt
        }
      }
    }
  }
`;

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;

  if (!GITHUB_TOKEN) {
    console.error('Error: GITHUB_TOKEN environment variable is missing.');
    process.exit(1);
  }

  if (!GITHUB_REPOSITORY || !GITHUB_REPOSITORY.includes('/')) {
    console.error('Error: GITHUB_REPOSITORY environment variable is missing or malformed.');
    process.exit(1);
  }

  const username = GITHUB_REPOSITORY.split('/')[0];
  if (!username) {
    console.error('Error: Could not extract username from GITHUB_REPOSITORY.');
    process.exit(1);
  }

  let response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Node.js',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
      body: JSON.stringify({
        query: GRAPHQL_QUERY,
        variables: {
          login: username,
          searchQuery: `user:${username} topic:featured sort:updated-desc`,
        },
      }),
    });
  } catch (error) {
    console.error('Network Error: Failed to execute fetch against GitHub GraphQL API:', error);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`HTTP Error: GitHub API responded with status ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    console.error('Parse Error: Failed to parse JSON response from GitHub API:', error);
    process.exit(1);
  }

  if (!payload || typeof payload !== 'object') {
    console.error('Validation Error: Received malformed payload.');
    process.exit(1);
  }

  if (payload.errors && payload.errors.length > 0) {
    console.error('GraphQL Error: API returned errors:', JSON.stringify(payload.errors, null, 2));
    process.exit(1);
  }

  const pinnedNodes = payload.data?.user?.pinnedItems?.nodes;
  const searchNodes = payload.data?.search?.nodes;

  if (!Array.isArray(pinnedNodes) || !Array.isArray(searchNodes)) {
    console.error('Validation Error: Missing expected pinnedItems or search nodes in payload.');
    process.exit(1);
  }

  const seenIds = new Set();
  const repositories = [];

  for (const node of pinnedNodes) {
    if (node?.id && !seenIds.has(node.id)) {
      seenIds.add(node.id);
      repositories.push(node);
    }
  }

  for (const node of searchNodes) {
    if (node?.id && !seenIds.has(node.id)) {
      seenIds.add(node.id);
      repositories.push(node);
    }
  }

  if (repositories.length === 0) {
    console.error('Validation Error: No repositories found. Aborting to protect README content.');
    process.exit(1);
  }

  const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));

  let readmeContent;
  try {
    readmeContent = await fs.readFile(readmePath, 'utf8');
  } catch (error) {
    console.error(`File Error: Failed to read README at ${readmePath}:`, error);
    process.exit(1);
  }

  const portfolioRegex = /(<!-- PORTFOLIO-START -->)[\s\S]*?(<!-- PORTFOLIO-END -->)/;
  if (!portfolioRegex.test(readmeContent)) {
    console.error('Format Error: README.md is missing PORTFOLIO comment boundary markers.');
    process.exit(1);
  }

  const newline = readmeContent.includes('\r\n') ? '\r\n' : '\n';

  const markdownItems = repositories.map((repo) => {
    const description = repo.description ? `${newline}  ${repo.description.trim()}` : '';
    return `- **[${repo.name}](${repo.url})**${description}${newline}`;
  });

  const portfolioMarkdown = markdownItems.join(newline);

  const updatedReadme = readmeContent.replace(
    portfolioRegex,
    (match, startTag, endTag) => `${startTag}${newline}${portfolioMarkdown}${endTag}`
  );

  try {
    await fs.writeFile(readmePath, updatedReadme, 'utf8');
    console.log(`Successfully updated portfolio in ${readmePath} with ${repositories.length} repositories.`);
  } catch (error) {
    console.error(`File Error: Failed to write updated README at ${readmePath}:`, error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled Error:', error);
  process.exit(1);
});
