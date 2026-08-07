import { SourceLocation } from '../../shared/value-objects';

export interface ConfigKey {
  name: string;
  doc: string;
  location: SourceLocation;
}

export interface ConfigKeyRepository {
  keys(): ConfigKey[];
  find(name: string): ConfigKey | undefined;
}
