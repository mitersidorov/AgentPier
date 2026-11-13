import { ReleaseOperation } from '../../tasks/types/release-operation.type';

export type Step = {
  id: string;
  title: string;
  description: string;
  targetBranch: string;
  profile?: string;
  appId?: string;
  repositoryId?: string;
  dependsOn: string[];
  checks?: string[];
  releaseOperations?: ReleaseOperation[];
};
