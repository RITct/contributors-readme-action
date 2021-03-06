const core = require("@actions/core");
const github = require("@actions/github");

const readMeCore = require("./core");

async function run() {
    try {
        if (github.context.payload.action) {
            if (github.context.payload.action !== "closed") return;
        }

        // get various inputs applied in action.yml
        const path = core.getInput("readme_path").trim();
        const affiliation = core.getInput("collaborators").trim();
        const message = core.getInput("commit_message").trim();
        const name = core.getInput("committer_username").trim();
        const email = core.getInput("committer_email").trim();

        // get repo token
        const token = process.env["GITHUB_TOKEN"];

        if (!token) {
            throw new Error("Token not found");
        }

        // octakit library to access various functions
        const octokit = github.getOctokit(token);
        const nwo = process.env["GITHUB_REPOSITORY"] || "/";
        const [owner, repo] = nwo.split("/");

        // get the readme of the repo
        const readme = await octokit.repos.getContent({ owner, repo, path });

        if (readme.headers.status === "404") {
            console.log("readme not added");
            return;
        }

        // get all contributors of the repo max:500
        const contributors_list = await octokit.repos.listContributors({ owner, repo });
        const collaborators_list = await octokit.repos.listCollaborators({
            owner,
            repo,
            affiliation,
        });

        // get data of contributors
        // collaborators
        // bots
        const contributors = contributors_list.data.filter((el) => el.type !== "Bot");
        const contributorsBots = contributors_list.data
            .filter((el) => el.type === "Bot")
            .map(({ login, avatar_url }) => ({
                login: login,
                avatar_url,
                name: login,
                type: "bot",
            }));
        const collaborators = collaborators_list.data.filter((el) => el.type !== "Bot");
        const collaboratorsBots = contributors_list.data
            .filter((el) => el.type === "Bot")
            .map(({ login, avatar_url }) => ({
                login: login,
                avatar_url,
                name: login,
                type: "bot",
            }));
        const bots = [...contributorsBots, ...collaboratorsBots];
        // parse the base64 readme
        let content = Buffer.from(readme.data.content, "base64").toString("ascii");
        const prevContent = content;

        /**
         * regex expresstion to get all the special readme tags
         * eg: <!-- readme:contributors -start --!> anything inside this<!-- readme:contributors -end --!>
         * gets these matched and the content inside of these tags to an array
         */
        // get all tag comments with the given format
        const getAllReadmeComments = content.match(
            /<!--\s*readme:\s*[a-zA-Z0-9,-]*\s*-start\s*-->[\s\S]*?<!--\s*readme:\s*[a-zA-Z0-9,-]*\s*-end\s*-->/gm
        );

        // return action if no tags were found
        if (!getAllReadmeComments) {
            console.log("No contrib comments were attached");
            return;
        }

        // based on tags update the content
        for (let match = 0; match < getAllReadmeComments.length; match++) {
            content = await readMeCore.buildContent(
                getAllReadmeComments[match],
                contributors,
                collaborators,
                bots,
                content,
                octokit
            );
        }

        const base64String = Buffer.from(content).toString("base64");

        if (prevContent !== content) {
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                message,
                content: base64String,
                path,
                sha: readme.data.sha,
                committer: {
                    name,
                    email,
                },
            });
            console.log("Updated contribution section of readme");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
