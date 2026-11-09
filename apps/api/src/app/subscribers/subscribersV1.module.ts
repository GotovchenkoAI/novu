import { forwardRef, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CommunityOrganizationRepository } from '@novu/dal';
import { AuthModule } from '../auth/auth.module';
import { ChannelEndpointsModule } from '../channel-endpoints/channel-endpoints.module';
import { OutboundWebhooksModule } from '../outbound-webhooks/outbound-webhooks.module';
import { PreferencesModule } from '../preferences';
import { SharedModule } from '../shared/shared.module';
import { PurgeSubscriberDataModule } from '../subscribers-v2/usecases/remove-subscriber/purge-subscriber-data';
import { WidgetsModule } from '../widgets/widgets.module';
import { SubscribersV1Controller } from './subscribersV1.controller';
import { USE_CASES } from './usecases';

@Module({
  imports: [
    SharedModule,
    AuthModule,
    TerminusModule,
    forwardRef(() => WidgetsModule),
    PreferencesModule,
    ChannelEndpointsModule,
    OutboundWebhooksModule.forRoot(),
    PurgeSubscriberDataModule,
  ],
  controllers: [SubscribersV1Controller],
  providers: [...USE_CASES, CommunityOrganizationRepository],
  exports: [...USE_CASES],
})
export class SubscribersV1Module {}
