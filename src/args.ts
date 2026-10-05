export interface RunArgs {
  task: string | null;
  file: string | null;
  config: string | null;
  maxIterations: number | null;
  model: string | null;
}

export type Parsed =
  | { kind: "run"; args: RunArgs }
  | { kind: "help" }
  | { kind: "version" };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const USAGE = `usage: duckor run "<task>" | -f PROMPT.md  [-c duckor.yml]
                  [--max-iterations N] [--model M]
       duckor --version`;

export const HELP = `${USAGE}

Duckor: an autonomous coding loop on claude -p

commands:
  run                   run the loop on a task until it completes or hits a limit

run options:
  -f, --file FILE       read the task from FILE
  -c, --config FILE     config file (default: ./duckor.yml, else the solo preset)
  --max-iterations N    override loop.max_iterations
  --model M             override agent.model
  -h, --help            show this help message and exit`;

const VALUE_FLAGS: Record<string, keyof Omit<RunArgs, "task">> = {
  "-f": "file",
  "--file": "file",
  "-c": "config",
  "--config": "config",
  "--max-iterations": "maxIterations",
  "--model": "model",
};

function parseRun(argv: string[]): Parsed {
  const args: RunArgs = { task: null, file: null, config: null, maxIterations: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { kind: "help" };
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq === -1 ? a : a.slice(0, eq);
    const key = VALUE_FLAGS[flag];
    if (key === undefined) {
      if (a.startsWith("-") && a !== "-") throw new UsageError(`unrecognized argument: ${a}`);
      if (args.task !== null) throw new UsageError(`unexpected argument: ${a}`);
      args.task = a;
      continue;
    }
    let value: string;
    if (eq !== -1) value = a.slice(eq + 1);
    else if (i + 1 < argv.length) value = argv[++i];
    else throw new UsageError(`${flag} needs a value`);
    if (key === "maxIterations") {
      if (!/^[1-9][0-9]*$/.test(value)) throw new UsageError(`${flag}: expected a positive integer, got "${value}"`);
      args.maxIterations = Number(value);
    } else {
      args[key] = value;
    }
  }
  if (args.task !== null && args.file !== null) throw new UsageError("give a task or --file, not both");
  if (args.task === null && args.file === null) throw new UsageError("give a task or --file");
  return { kind: "run", args };
}

export function parseArgs(argv: string[]): Parsed {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "-h" || cmd === "--help") return { kind: "help" };
  if (cmd === "--version") return { kind: "version" };
  if (cmd === "run") return parseRun(rest);
  throw new UsageError(`unknown command: ${cmd}`);
}
