import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
declare const name = "@ipfans/dsh-connect-codearts";
declare const inject: string[];
declare const Config: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
declare function apply(ctx: Context): void;
export { Config, apply, inject, name };