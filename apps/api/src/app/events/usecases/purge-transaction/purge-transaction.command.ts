import { IsDefined, IsString } from 'class-validator';
import { EnvironmentWithUserCommand } from '../../../shared/commands/project.command';

export class PurgeTransactionCommand extends EnvironmentWithUserCommand {
  @IsDefined()
  @IsString()
  transactionId: string;
}
