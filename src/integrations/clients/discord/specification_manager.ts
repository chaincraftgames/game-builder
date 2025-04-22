import { ThreadChannel, Message, AttachmentBuilder } from "discord.js";
import { getFullDesignSpecification } from "#chaincraft/ai/design/design-workflow.js";
import { GameDesignSpecification } from "#chaincraft/ai/design/game-design-state.js";

const specificationMessageRegex = /^Specification Version: (\d+)/;
const specificationAttachmentName = "specification.txt";

// Define interface for specification result
export interface SpecificationInfo {
  specification: GameDesignSpecification;
  version: number;
}

export async function getSpecificationForThread(
  thread: ThreadChannel
): Promise<SpecificationInfo | undefined> {
  const message = await getSpecificationMessage(thread);
  if (!message) {
    // No specification message found, get it from the AI
    return await updateSpecification(thread);
  }

  // Get the specification from the attachment
  const attachment = message.attachments.find(
    (a) => a.name === specificationAttachmentName
  );
  if (!attachment) {
    // Message exists but no attachment, try to get it from the AI
    return await updateSpecification(thread);
  }

  console.debug("[specification-manager] Retrieving cached specification.");
  try {
    const response = await fetch(attachment.url);
    const specification = (await JSON.parse(
      await response.text()
    )) as GameDesignSpecification;

    return {
      specification: specification,
      version: getSpecificationVersion(message),
    };
  } catch (error) {
    console.error("Error fetching specification attachment:", error);
    return undefined;
  }
}

export async function setSpecificationForThread(
  thread: ThreadChannel,
  specification: GameDesignSpecification
): Promise<Message | undefined> {
  let message = await getSpecificationMessage(thread);
  console.debug("[specification-manager] Specification message: %s", message?.content);
  const version = message ? getSpecificationVersion(message) + 1 : 1;

  // Create attachment from specification
  const attachment = new AttachmentBuilder(
    Buffer.from(JSON.stringify(specification, null, 2), "utf8"),
    { name: specificationAttachmentName }
  );

  try {
    if (message) {
      // Update existing message
      await message.edit({
        content: `Specification Version: ${version}`,
        files: [attachment],
      });
    } else {
      // Create a new message and pin it
      message = await thread.send({
        content: `Specification Version: ${version}`,
        files: [attachment],
      });
      await message.pin();
    }
    return message;
  } catch (error) {
    console.error("Error setting specification for thread:", error);
    return undefined;
  }
}

export async function clearSpecification(thread: ThreadChannel): Promise<void> {
  const message = await getSpecificationMessage(thread);
  if (message) {
    const version = getSpecificationVersion(message);
    // Keep the message but remove the attachment
    await message.edit({
      content: `Specification Version: ${version} (cleared)`,
      files: [],
    });
  }
}

async function updateSpecification(
  thread: ThreadChannel
): Promise<SpecificationInfo | undefined> {
  try {
    console.debug(
      "[specification-manager] Getting updated specification from design agent."
    );
    const specification = await getFullDesignSpecification(thread.id);
    if (specification) {
      // Cache the specification
      const message = await setSpecificationForThread(thread, specification);
      if (message) {
        const version = getSpecificationVersion(message);
        return { specification, version };
      }
    }
  } catch (error) {
    console.error("Error fetching specification from AI:", error);
  }
  return undefined;
}

async function getSpecificationMessage(
  thread: ThreadChannel
): Promise<Message | undefined> {
  // Get the pinned message that matches the regex
  const messages = await thread.messages.fetchPinned();
  return messages.find((message) =>
    specificationMessageRegex.test(message.content)
  );
}

/** 
 * Returns the specification version cached in the specification message, or 0 if the message
 * does not contain a version. 
 */
function getSpecificationVersion(message: Message): number {
  const match = message.content.match(specificationMessageRegex);
  return match ? parseInt(match[1], 10) : 0;
}
