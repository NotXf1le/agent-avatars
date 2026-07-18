import * as nodeFs from "node:fs";
import { basename, join } from "node:path";

function missingPath(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

function inspectTarget(fs, path, name) {
  try {
    const stat = fs.lstatSync(path);
    if (!stat.isFile()) {
      throw new TypeError(`Export target must be absent or a regular file: ${name}.`);
    }
    return true;
  } catch (error) {
    if (missingPath(error)) return false;
    throw error;
  }
}

function rollbackFileSet(fs, installed, backups, stagingDirectory, outputDirectory, removeOutputDirectory) {
  const errors = [];
  const attempt = (operation) => {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  };

  for (let index = installed.length - 1; index >= 0; index--) {
    attempt(() => fs.rmSync(installed[index].targetPath, { force: true }));
  }

  const restoreOrder = [...backups].sort((left, right) => Number(left.commitLast) - Number(right.commitLast));
  for (const backup of restoreOrder) {
    attempt(() => fs.renameSync(backup.backupPath, backup.targetPath));
  }

  if (stagingDirectory) {
    attempt(() => fs.rmSync(stagingDirectory, { recursive: true, force: true }));
  }
  if (removeOutputDirectory) {
    attempt(() => fs.rmdirSync(outputDirectory));
  }
  return errors;
}

function replaceFileSetSync(outputDirectory, entries, fs = nodeFs) {
  const outputDirectoryExisted = fs.existsSync(outputDirectory);
  let stagingDirectory;
  const installed = [];
  const backups = [];

  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    stagingDirectory = fs.mkdtempSync(join(outputDirectory, ".agent-avatars-stage-"));

    const prepared = entries.map((entry, index) => {
      if (!entry || typeof entry.name !== "string" || basename(entry.name) !== entry.name) {
        throw new TypeError("Transaction entry names must be plain file names.");
      }
      const stagedPath = join(stagingDirectory, `new-${index}`);
      const targetPath = join(outputDirectory, entry.name);
      fs.writeFileSync(stagedPath, entry.data, entry.encoding
        ? { encoding: entry.encoding, flag: "wx" }
        : { flag: "wx" });
      return {
        ...entry,
        stagedPath,
        targetPath,
        existed: false,
        backupPath: join(stagingDirectory, `backup-${index}`),
      };
    });

    for (const entry of prepared) {
      entry.existed = inspectTarget(fs, entry.targetPath, entry.name);
    }

    const backupOrder = [...prepared].sort((left, right) => Number(right.commitLast) - Number(left.commitLast));
    for (const entry of backupOrder) {
      if (!entry.existed) continue;
      fs.renameSync(entry.targetPath, entry.backupPath);
      backups.push(entry);
    }

    const installOrder = [...prepared].sort((left, right) => Number(left.commitLast) - Number(right.commitLast));
    for (const entry of installOrder) {
      fs.renameSync(entry.stagedPath, entry.targetPath);
      installed.push(entry);
    }

    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    const rollbackErrors = rollbackFileSet(
      fs,
      installed,
      backups,
      stagingDirectory,
      outputDirectory,
      !outputDirectoryExisted
    );
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Export failed and rollback was incomplete.");
    }
    throw error;
  }
}

export { replaceFileSetSync };
