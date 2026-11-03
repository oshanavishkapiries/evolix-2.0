"""Generate the app parity fixture without loading settings or any environment file."""
import ast
import json
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/vectors/engine_config_keys.json"


def specs():
    tree = ast.parse((ROOT / "app/core/runtime_config.py").read_text())
    nodes = [ast.ImportFrom(module="dataclasses", names=[ast.alias(name="dataclass")], level=0)]
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Spec":
            nodes.append(node)
        if isinstance(node, (ast.Assign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(t, ast.Name) and t.id in ("SPECS", "EXTRACTOR_ORDERS") for t in targets):
                nodes.append(node)
    namespace = {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), "specs", "exec"), namespace)
    return [{**asdict(s), "secret": s.kind == "secret", "restartNeeded": not s.live} for s in namespace["SPECS"]]


def rendered():
    return json.dumps(specs(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    FIXTURE.write_text(rendered())
