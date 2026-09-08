import { ReleaseInfo } from '../release';

export interface ReleaseSource {
  latest(): Promise<ReleaseInfo | undefined>;
}
