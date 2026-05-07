export interface DoorConfig {
  name: string;
  statusSet: string;
  commandPayload?: string;
  openGet?: string;
  openValue?: string | boolean | number;
  closedGet?: string;
  closedValue?: string | boolean | number;
  openStatusCmdTopic?: string;
  openStatusCmd?: string;
  closeStatusCmdTopic?: string;
  closeStatusCmd?: string;
  lwt?: string;
  lwtPayload?: string | boolean | number;
  doorRunInSeconds?: number;
  pauseInSeconds?: number;
  showlog?: boolean;
}

export interface PlatformConfig {
  name?: string;
  url: string;
  username?: string;
  password?: string;
  rejectUnauthorized?: boolean;
  doors: DoorConfig[];
}
