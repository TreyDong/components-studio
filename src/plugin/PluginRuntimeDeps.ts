/**
 * 插件运行时依赖的共享类型（ComponentsStudioPlugin 装配并持有；
 * commands/settings/view 通过惰性 getter 消费，避免循环 import）。
 */

import type { DocumentCodec } from "../document/codec";
import type { SessionFactory } from "../session/SessionFactory";
import type { ComponentRegistry } from "../registry/ComponentRegistry";
import { HostStateStore, RuntimeHostStore } from "../runtime";
import type {
  RuntimeDocumentPort,
  RuntimeServices,
} from "../runtime/types";
import type { PlatformPort, TextFileSnapshot } from "../platform/ports";
import type { RecoveryPortV1 } from "@ocs/contracts";
import type { DocumentFileCreator } from "./create-document";

export type ServicesFactoryFn = (input: {
  readonly document: RuntimeDocumentPort;
  readonly host: RuntimeHostStore;
  readonly hostState: HostStateStore;
}) => RuntimeServices;

export interface PluginRuntimeDeps {
  readonly factory: SessionFactory;
  readonly codec: DocumentCodec;
  readonly registry: ComponentRegistry;
  readonly platform: PlatformPort;
  readonly recovery: RecoveryPortV1;
  readonly documentCreator: DocumentFileCreator;
  readonly servicesFactory: ServicesFactoryFn;
  /** View/Embed 的 hostId 前缀（插件 id）。 */
  readonly hostIdPrefix: string;
}

export type { TextFileSnapshot };
