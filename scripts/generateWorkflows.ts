import * as fs from "fs/promises";
import { parse } from "yaml";

const makeWorkflowYaml = ({
  repo,
  tag,
  slug,
  solanaVersion = "1.7.11",
}: {
  repo: string;
  tag: string;
  slug: string;
  solanaVersion?: string;
}) => {
  return `
name: Verify ${repo} ${tag}

on:
  push:
    paths:
      - ".github/workflows/verify-${slug}.yml"

env:
  CARGO_TERM_COLOR: always
  SOLANA_VERSION: "${solanaVersion}"
  RUST_TOOLCHAIN: nightly-2021-09-01

jobs:
  release-binaries:
    runs-on: ubuntu-latest
    name: Release verifiable binaries
    steps:
      - uses: actions/checkout@v2
      - uses: cachix/install-nix-action@v14
        with:
          install_url: https://nixos-nix-install-tests.cachix.org/serve/i6laym9jw3wg9mw6ncyrk6gjx4l34vvx/install
          install_options: "--tarball-url-prefix https://nixos-nix-install-tests.cachix.org/serve"
          extra_nix_config: |
            experimental-features = nix-command flakes
      - name: Setup Cachix
        uses: cachix/cachix-action@v10
        with:
          name: saber
          authToken: \${{ secrets.CACHIX_AUTH_TOKEN }}
      - name: Download sources from GitHub
        run: curl -L https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz > release.tar.gz
      - name: Extract sources
        run: tar xzvf release.tar.gz
      - name: Perform verifiable build
        run: nix shell .#ci --command anchor build --verifiable --solana-version ${solanaVersion}
      - name: Record program artifacts
        run: |
          mkdir artifacts
          mv target/verifiable/ artifacts/verifiable/
          mv target/idl/ artifacts/idl/

          sha256sum release.tar.gz > artifacts/release-checksums.txt
          sha256sum target/verifiable/* > artifacts/program-checksums.txt
          sha256sum target/idl/* > artifacts/idl-checksums.txt

          echo '# ${repo} ${tag}' >> artifacts/README.md
          echo '\`\`\`' >> artifacts/README.md
          anchor --version >> artifacts/README.md
          date >> artifacts/README.md
          sha256sum release.tar.gz >> artifacts/README.md
          echo '\`\`\`' >> artifacts/README.md

          echo '## Program checksums' >> artifacts/README.md
          echo '\`\`\`' >> artifacts/README.md
          sha256sum target/verifiable/* >> artifacts/README.md
          echo '\`\`\`' >> artifacts/README.md

          echo '## IDL checksums' >> artifacts/README.md
          echo '\`\`\`' >> artifacts/README.md
          sha256sum target/idl/* > artifacts/README.md
          echo '\`\`\`' >> artifacts/README.md
      - name: Upload
        uses: peaceiris/actions-gh-pages@v3
        with:
          deploy_key: \${{ secrets.DIST_DEPLOY_KEY }}
          external_repository: DeployDAO/verified-program-artifacts
          publish_branch: verify-${slug}
          publish_dir: ./artifacts/
`;
};

const generateWorkflows = async () => {
  const programsListRaw = await fs.readFile(`${__dirname}/../programs.yml`);
  const programsList = parse(programsListRaw.toString()) as Record<
    string,
    string[]
  >;

  const allTags = Object.entries(programsList).flatMap(([repo, tags]) =>
    tags.map((tag) => [repo, tag] as const)
  );

  const outDir = `${__dirname}/../out/`;
  await fs.mkdir(outDir, { recursive: true });
  const workflowsDir = `${outDir}/.github/workflows/`;
  await fs.mkdir(workflowsDir, { recursive: true });
  for (const [repo, tag] of allTags) {
    const slug = `${repo.replace("/", "__")}-${tag}`;
    await fs.writeFile(
      `${workflowsDir}/verify-${slug}.yml`,
      makeWorkflowYaml({ repo, tag, slug })
    );
  }
};

generateWorkflows().catch((err) => console.error(err));
