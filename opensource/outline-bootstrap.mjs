/* Bootstrap only the isolated local installation, using upstream models. */
import path from "node:path";
import { createRequire } from "node:module";
const requireOutline = createRequire(path.join(process.cwd(), "package.json"));
const load = (file) => requireOutline(path.join(process.cwd(), "build", file));

async function main() {
  requireOutline("zod/compile");
  load("server/scripts/bootstrap.js");
  const { sequelize } = load("server/storage/database.js");
  const { Team, User } = load("server/models/index.js");
  const { createContext } = load("server/context.js");
  const { provisionFirstCollection } = load("server/commands/accountProvisioner.js");
  const email = "admin@outline.local";

  await sequelize.transaction(async (transaction) => {
    const [team] = await Team.findOrCreate({
      where: { subdomain: "fob-outline-local" },
      defaults: { name: "Outline Local", guestSignin: true },
      transaction,
    });
    await User.findOrCreate({
      where: { teamId: team.id, email },
      defaults: { name: "Local Admin", role: "admin", language: "zh_CN" },
      transaction,
    });
  });

  const user = await User.scope("withTeam").findOne({ where: { email } });
  if (!(await user.team.$count("collections"))) {
    await provisionFirstCollection(createContext({ user }), user.team, user);
  }
  await sequelize.close();
  console.log(`Local workspace ready. Sign in as ${email}; read the verification email at http://localhost:3803.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
