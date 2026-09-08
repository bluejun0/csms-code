import { ReleaseInfo } from '../../domain/updates/release';
import { ReleaseSource } from '../../domain/updates/ports/release-source';

const REQUEST_TIMEOUT_MS = 5000;
const SLUG = /^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/;

export function repoSlugOf(repositoryUrl: string | undefined): string | undefined {
  const m = repositoryUrl?.match(SLUG);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

interface Asset { name?: unknown; browser_download_url?: unknown }

/** 이 URL로 받은 파일을 그대로 설치하므로 출처를 github.com으로 못박는다. */
function downloadUrlOf(asset: Asset | undefined): string | undefined {
  if (typeof asset?.browser_download_url !== 'string') return undefined;
  try {
    const u = new URL(asset.browser_download_url);
    return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : undefined;
  } catch { return undefined; }
}

export function releaseFromApi(body: unknown): ReleaseInfo | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const r = body as Record<string, unknown>;
  if (r.draft === true || typeof r.tag_name !== 'string') return undefined;
  const assets = Array.isArray(r.assets) ? (r.assets as Asset[]) : [];
  const vsix = assets.find(a => typeof a.name === 'string' && a.name.endsWith('.vsix'));
  return {
    version: r.tag_name,
    notes: typeof r.body === 'string' ? r.body : '',
    pageUrl: typeof r.html_url === 'string' ? r.html_url : '',
    assetUrl: downloadUrlOf(vsix),
  };
}

/** 공개 저장소의 최신 릴리스를 인증 없이 읽는다. 실패는 호출부(CheckForUpdate)가 침묵으로 처리한다. */
export class GitHubReleaseSource implements ReleaseSource {
  constructor(private readonly slug: string) {}

  async latest(): Promise<ReleaseInfo | undefined> {
    const res = await fetch(`https://api.github.com/repos/${this.slug}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    return releaseFromApi(await res.json());
  }
}
