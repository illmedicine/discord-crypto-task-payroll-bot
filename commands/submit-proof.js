const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit-proof')
    .setDescription('Submit proof of task completion with screenshot and verification URL')
    .addIntegerOption(option =>
      option.setName('assignment_id')
        .setDescription('Your task assignment ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    const assignmentId = interaction.options.getInteger('assignment_id');
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Verify assignment exists and belongs to user
    // Create an embed with instructions
    const instructionEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('📸 Submit Task Proof')
      .setDescription('Follow these steps to submit your proof:')
      .addFields(
        { name: 'Step 1: Upload Screenshot', value: 'Reply to this message with your screenshot image (paste directly or upload file)' },
        { name: 'Step 2: Verify Task Completion', value: 'Click the button below to enter your verification URL' },
        { name: 'Tips', value: '• You can paste images directly into Discord\n• Screenshot must show clear evidence of task completion\n• Verification URL must match the task requirement' }
      )
      .setTimestamp();

    const verifyButton = new ButtonBuilder()
      .setCustomId(`proof_verification_${assignmentId}_${userId}`)
      .setLabel('Enter Verification URL')
      .setStyle(ButtonStyle.Primary);

    const buttonRow = new ActionRowBuilder().addComponents(verifyButton);

    const responseMsg = await interaction.reply({
      embeds: [instructionEmbed],
      components: [buttonRow],
      ephemeral: false
    });

    // Store the assignment ID and user ID in the message for image collection
    const imageCollectorFilter = (msg) => msg.author.id === userId && msg.reference?.messageId === responseMsg.id;
    const imageCollector = interaction.channel.createMessageCollector({
      filter: imageCollectorFilter,
      max: 1,
      maxProcessed: 1
    });

    let screenshotUrl = null;

    imageCollector.on('collect', async (msg) => {
      if (msg.attachments.size > 0) {
        const attachment = msg.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          screenshotUrl = attachment.url;
          
          // Acknowledge the screenshot
          const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Screenshot Received')
            .setDescription('Your screenshot has been captured. Now click the button above to enter your verification URL.')
            .setImage(screenshotUrl);

          await msg.reply({ embeds: [confirmEmbed] });
        } else {
          await msg.reply({
            content: '❌ Please upload an image file (PNG, JPG, etc.)',
            ephemeral: true
          });
        }
      } else {
        await msg.reply({
          content: '❌ No image found. Please attach an image to your message.',
          ephemeral: true
        });
      }
    });

    imageCollector.on('end', () => {
      // Collector ended without receiving image
      if (!screenshotUrl) {
        console.log(`No screenshot uploaded for assignment ${assignmentId}`);
      }
    });

    // Store screenshot URL and assignment ID for button handler
    global.proofSubmissions = global.proofSubmissions || {};
    global.proofSubmissions[`${assignmentId}_${userId}`] = { screenshotUrl: null };

    // Return the handler for the button
    return { screenshotUrl, assignmentId, userId, guildId };
  },

  // Handle button click for verification URL
  handleVerificationButton: async (interaction, client) => {
    const parts = interaction.customId.split('_');
    const assignmentId = parseInt(parts[2]);
    const userId = parts[3];

    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: '❌ You can only submit proof for your own assignments.',
        ephemeral: true
      });
    }

    // Get the parent message to check for screenshots
    const parentMsg = interaction.message;
    let screenshotUrl = null;

    // Search recent messages in the channel for screenshot from this user
    try {
      const messages = await parentMsg.channel.messages.fetch({ limit: 10 });
      for (const [msgId, msg] of messages) {
        if (msg.author.id === userId && msg.attachments.size > 0) {
          const attachment = msg.attachments.first();
          if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            screenshotUrl = attachment.url;
            break;
          }
        }
      }
    } catch (e) {
      console.error('Error fetching messages:', e);
    }

    if (!screenshotUrl) {
      return interaction.reply({
        content: '❌ No screenshot found. Please upload your screenshot as a reply to the original message first.',
        ephemeral: true
      });
    }

    // Create modal for verification URL
    const modal = new ModalBuilder()
      .setCustomId(`proof_modal_${assignmentId}_${userId}`)
      .setTitle('Task Proof Verification');

    const verificationInput = new TextInputBuilder()
      .setCustomId('verification_url')
      .setLabel('Verification URL')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://example.com/verification')
      .setRequired(true)
      .setMinLength(10);

    const notesInput = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel('Additional Notes (Optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Explain your proof or provide context...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(verificationInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    // Store screenshot URL temporarily
    if (!global.proofData) global.proofData = {};
    global.proofData[`${assignmentId}_${userId}`] = { screenshotUrl };

    await interaction.showModal(modal);
  },

  // Handle modal submission
  handleModal: async (interaction) => {
    if (!interaction.customId.startsWith('proof_modal_')) return;

    const parts = interaction.customId.split('_');
    const assignmentId = parseInt(parts[2]);
    const userId = parts[3];

    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: '❌ You can only submit proof for your own assignments.',
        ephemeral: true
      });
    }

    const guildId = interaction.guildId;
    const verificationUrl = interaction.fields.getTextInputValue('verification_url');
    const notes = interaction.fields.getTextInputValue('notes') || '';

    // Get screenshot from temporary storage
    const proofData = global.proofData?.[`${assignmentId}_${userId}`] || {};
    const screenshotUrl = proofData.screenshotUrl;

    if (!screenshotUrl) {
      return interaction.reply({
        content: '❌ Screenshot not found. Please upload the screenshot first.',
        ephemeral: true
      });
    }

    try {
      // Get assignment which now includes bulk task details via JOIN
      const assignment = await db.getAssignment(assignmentId);
      if (!assignment) {
        return interaction.reply({
          content: '❌ Assignment not found.',
          ephemeral: true
        });
      }

      // Check if bulk task is active
      if (assignment.task_status !== 'active') {
        return interaction.reply({
          content: '❌ This task is no longer active.',
          ephemeral: true
        });
      }

      // Check auto-approve settings
      const autoApproveSettings = await db.getAutoApproveSettings(assignment.bulk_task_id);
      let autoApproved = false;
      let autoApproveError = null;
      let paymentInfo = null;

      // Submit proof to database
      const proofId = await db.submitProof(
        assignmentId,
        guildId,
        userId,
        screenshotUrl,
        verificationUrl,
        notes
      );

      // Check if auto-approve is enabled and requirements are met
      if (autoApproveSettings && autoApproveSettings.auto_approve_enabled) {
        let requirementsMet = true;
        const missingRequirements = [];

        // Check screenshot requirement
        if (autoApproveSettings.require_screenshot && !screenshotUrl) {
          requirementsMet = false;
          missingRequirements.push('Screenshot');
        }

        // Check verification URL requirement
        if (autoApproveSettings.require_verification_url && (!verificationUrl || verificationUrl.trim().length < 10)) {
          requirementsMet = false;
          missingRequirements.push('Verification URL');
        }

        if (requirementsMet) {
          // Automatically approve the proof
          try {
            await db.approveProof(proofId, 'auto-system');
            autoApproved = true;

            // Try to process payment
            try {
              const userData = await db.getUser(userId);
              if (!userData || !userData.solana_address) {
                autoApproveError = 'User wallet not connected';
              } else if (!crypto.isValidSolanaAddress(userData.solana_address)) {
                autoApproveError = 'Invalid wallet address';
              } else {
                const guildWallet = await db.getGuildWallet(guildId);
                if (!guildWallet) {
                  autoApproveError = 'Treasury wallet not configured';
                } else {
                  // Calculate SOL amount
                  let solAmount = assignment.payout_amount;
                  if (assignment.payout_currency === 'USD') {
                    const solPrice = await crypto.getSolanaPrice();
                    if (!solPrice) {
                      autoApproveError = 'Unable to fetch SOL price';
                    } else {
                      solAmount = assignment.payout_amount / solPrice;
                    }
                  }

                  if (!autoApproveError) {
                    const treasuryBalance = await crypto.getBalance(guildWallet.wallet_address);
                    if (treasuryBalance < solAmount) {
                      autoApproveError = `Insufficient treasury balance (${treasuryBalance.toFixed(4)} SOL)`;
                    } else {
                      const botWallet = crypto.getWallet();
                      if (!botWallet) {
                        autoApproveError = 'Bot wallet not configured';
                      } else {
                        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
                        const recipientPubkey = new PublicKey(userData.solana_address);
                        const treasuryPubkey = new PublicKey(guildWallet.wallet_address);

                        const lamports = Math.floor(solAmount * 1e9);
                        const instruction = SystemProgram.transfer({
                          fromPubkey: treasuryPubkey,
                          toPubkey: recipientPubkey,
                          lamports: lamports
                        });

                        const transaction = new Transaction().add(instruction);
                        const signature = await sendAndConfirmTransaction(connection, transaction, [botWallet]);

                        await db.recordTransaction(guildId, guildWallet.wallet_address, userData.solana_address, solAmount, signature);

                        paymentInfo = {
                          amount: solAmount,
                          currency: assignment.payout_currency,
                          usdAmount: assignment.payout_currency === 'USD' ? assignment.payout_amount : null,
                          signature: signature
                        };
                      }
                    }
                  }
                }
              }
            } catch (paymentError) {
              console.error('Auto-payment error:', paymentError);
              autoApproveError = paymentError.message;
            }
          } catch (approvalError) {
            console.error('Auto-approval error:', approvalError);
            autoApproveError = approvalError.message;
          }
        } else {
          autoApproveError = `Missing required: ${missingRequirements.join(', ')}`;
        }
      }

      const embed = new EmbedBuilder()
        .setColor(autoApproved && paymentInfo ? '#00FF00' : autoApproved ? '#FFA500' : '#FFD700')
        .setTitle(autoApproved && paymentInfo ? '✅ Proof Auto-Approved & Paid!' : autoApproved ? '✅ Proof Auto-Approved!' : '📋 Proof Submitted Successfully!')
        .setDescription(
          autoApproved && paymentInfo 
            ? 'Your task proof met all requirements and has been automatically approved and paid!' 
            : autoApproved 
            ? 'Your task proof met all requirements and has been automatically approved!'
            : 'Your task proof has been submitted for review by the approval team.'
        )
        .addFields(
          { name: 'Assignment ID', value: `#${assignmentId}`, inline: true },
          { name: 'Proof ID', value: `#${proofId}`, inline: true },
          { name: 'Task', value: assignment.title },
          { name: 'Screenshot', value: `[View](${screenshotUrl})` },
          { name: 'Verification URL', value: `[View](${verificationUrl})` },
          ...(notes ? [{ name: 'Notes', value: notes }] : [])
        );

      if (autoApproved) {
        if (paymentInfo) {
          embed.addFields(
            { name: 'Status', value: '✅ **APPROVED & PAID**' },
            { name: '💰 Payment', value: `${paymentInfo.amount.toFixed(4)} SOL${paymentInfo.usdAmount ? ` (~$${paymentInfo.usdAmount.toFixed(2)} USD)` : ''}` },
            { name: 'Transaction', value: `[View on Explorer](https://solscan.io/tx/${paymentInfo.signature})` }
          );
        } else {
          embed.addFields(
            { name: 'Status', value: '✅ **APPROVED**' },
            { name: '⚠️ Payment', value: `Payment pending: ${autoApproveError || 'Processing'}` }
          );
        }
      } else if (autoApproveSettings && autoApproveSettings.auto_approve_enabled && autoApproveError) {
        embed.addFields(
          { name: 'Status', value: '⏳ **Awaiting Manual Approval**' },
          { name: 'Auto-Approve Failed', value: autoApproveError }
        );
      } else {
        embed.addFields(
          { name: 'Status', value: '⏳ Awaiting Approval' },
          { name: 'Next Step', value: 'An approver will review your submission soon and notify you of the result.' }
        );
      }

      embed.setFooter({ text: 'Do not modify your proof after submission' }).setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: false });

      // Clean up temporary data
      delete global.proofData?.[`${assignmentId}_${userId}`];

      // Notify approvers only if not auto-approved with payment
      if (!autoApproved || !paymentInfo) {
        const approverRoles = await db.getApprovedRoles(guildId);
        if (approverRoles.length > 0) {
          try {
            const guild = await interaction.guild.fetch();
            const members = await guild.members.fetch();
            
            const approvers = members.filter(m => {
              return m.roles.cache.some(r => approverRoles.includes(r.id));
            });

            if (approvers.size > 0) {
              const notificationEmbed = new EmbedBuilder()
                .setColor(autoApproved ? '#FFA500' : '#FFD700')
                .setTitle(autoApproved ? '⚠️ Auto-Approved (Payment Failed)' : '📋 New Proof Submission to Review')
                .addFields(
                  { name: 'Proof ID', value: `#${proofId}`, inline: true },
                  { name: 'Assignment ID', value: `#${assignmentId}`, inline: true },
                  { name: 'Submitted By', value: `<@${userId}>` },
                  { name: 'Task', value: assignment.title },
                  { name: 'Screenshot', value: `[View](${screenshotUrl})` },
                  { name: 'Verification', value: `[View](${verificationUrl})` },
                  ...(notes ? [{ name: 'Notes', value: notes }] : [])
                );

              if (autoApproved && autoApproveError) {
                notificationEmbed.addFields(
                  { name: 'Payment Issue', value: autoApproveError },
                  { name: 'Action', value: 'Use `/pay` or `/approve-proof approve` with payment to complete' }
                );
              } else {
                notificationEmbed.addFields(
                  { name: 'Action', value: 'Use `/approve-proof` to review this submission' }
                );
              }

              notificationEmbed.setImage(screenshotUrl).setTimestamp();

              // Send to first approver (in production, use notification channel)
              const firstApprover = approvers.first();
              try {
                await firstApprover.send({ embeds: [notificationEmbed] });
              } catch (e) {
                console.log('Could not DM approver');
              }
            }
          } catch (e) {
            console.log('Error notifying approvers:', e.message);
          }
        }
      }

    } catch (error) {
      console.error('Error submitting proof:', error);
      return interaction.reply({
        content: `❌ Error submitting proof: ${error.message}`,
        ephemeral: true
      });
    }
  }
};
