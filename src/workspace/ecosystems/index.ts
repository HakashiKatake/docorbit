import type { EcosystemStrategy } from './types.ts';
import { NpmStrategy } from './npm.ts';
import { CargoStrategy } from './cargo.ts';
import { GoStrategy } from './go.ts';
import { PyPiStrategy } from './pypi.ts';
import { ComposerStrategy } from './composer.ts';
import { RubyGemsStrategy } from './rubygems.ts';
import { PubStrategy } from './pub.ts';
import { MavenStrategy } from './maven.ts';

export type { EcosystemStrategy } from './types.ts';
export {
  NpmStrategy,
  CargoStrategy,
  GoStrategy,
  PyPiStrategy,
  ComposerStrategy,
  RubyGemsStrategy,
  PubStrategy,
  MavenStrategy,
};

export function getDefaultStrategies(): EcosystemStrategy[] {
  return [
    new NpmStrategy(),
    new CargoStrategy(),
    new GoStrategy(),
    new PyPiStrategy(),
    new ComposerStrategy(),
    new RubyGemsStrategy(),
    new PubStrategy(),
    new MavenStrategy(),
  ];
}
