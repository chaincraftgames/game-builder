import { PinataSDK } from "pinata-web3";

const pinataGateway = process.env.CHAINCRAFT_PINATA_GATEWAY;
const pinataJwt = process.env.CHAINCRAFT_PINATA_JWT;

let pinata: PinataSDK | undefined = undefined;

export async function uploadToIpfs(data: any, name: string): Promise<string> {
  const upload = await getPinata().upload.json(data).addMetadata({ name });

  return upload.IpfsHash;
}

export async function downloadFromIpfs<T>(
  hash: string
): Promise<T | undefined> {
  const data = (await getPinata().gateways.get(hash))?.data;
  if (!data) {
    throw new Error(
      `[Pinata - downloadFromIpfs] No data found for the hash ${hash}.`
    );
  }
  return data as T;
}

const getPinata = () => {
  if (pinata) {
    return pinata;
  }

  if (!pinataJwt) {
    throw new Error("Pinata JWT key is not set in environment variables.");
  }

  pinata = new PinataSDK({
    pinataJwt: `${pinataJwt}`,
    pinataGateway: `${pinataGateway}`,
  });

  return pinata;
};
