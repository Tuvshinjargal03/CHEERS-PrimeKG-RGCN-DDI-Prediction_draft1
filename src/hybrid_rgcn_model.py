import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import RGCNConv


class HybridStructuralRGCNDDIModel(nn.Module):
    """
    Exploratory hybrid R-GCN used for the structural-feature diagnostic.

    Node input:
        learned node-ID embedding
        + zero-initialized structural residual

    structural residual:
        structural_features @ structural_projection

    The structural projection is initialized to exactly zero so that,
    for the same random seed, all shared trainable parameters and the
    initial forward representation match the baseline RGCNDDIModel.
    """

    def __init__(
        self,
        num_nodes,
        num_relations,
        structural_features,
        embedding_dim=128,
        hidden_dim=128,
        dropout=0.2,
    ):
        super().__init__()

        if structural_features.ndim != 2:
            raise ValueError(
                "structural_features must have shape "
                "[num_nodes, num_features]"
            )

        if structural_features.shape[0] != num_nodes:
            raise ValueError(
                "structural_features row count must equal num_nodes"
            )

        # Keep baseline modules in the same construction order as
        # RGCNDDIModel. This preserves RNG-equivalent initialization
        # of all shared trainable tensors when the same seed is used.
        self.node_embedding = nn.Embedding(
            num_nodes,
            embedding_dim
        )

        self.conv1 = RGCNConv(
            embedding_dim,
            hidden_dim,
            num_relations
        )

        self.conv2 = RGCNConv(
            hidden_dim,
            hidden_dim,
            num_relations
        )

        self.dropout = dropout

        self.ddi_relation = nn.Parameter(
            torch.empty(hidden_dim)
        )

        self.reset_parameters()

        self.register_buffer(
            "structural_features",
            structural_features.detach().clone().float()
        )

        num_structural_features = (
            structural_features.shape[1]
        )

        # Direct zero-valued Parameter rather than nn.Linear:
        # creating it consumes no random initialization and therefore
        # does not perturb the baseline shared-parameter initialization.
        self.structural_projection = nn.Parameter(
            torch.zeros(
                num_structural_features,
                embedding_dim
            )
        )


    def reset_parameters(self):

        nn.init.xavier_uniform_(
            self.node_embedding.weight
        )

        self.conv1.reset_parameters()
        self.conv2.reset_parameters()

        nn.init.ones_(
            self.ddi_relation
        )


    def encode(
        self,
        edge_index,
        edge_type
    ):

        structural_residual = (
            self.structural_features
            @ self.structural_projection
        )

        x = (
            self.node_embedding.weight
            + structural_residual
        )

        x = self.conv1(
            x,
            edge_index,
            edge_type
        )

        x = F.relu(x)

        x = F.dropout(
            x,
            p=self.dropout,
            training=self.training
        )

        x = self.conv2(
            x,
            edge_index,
            edge_type
        )

        return x


    def decode(
        self,
        z,
        pair_index
    ):

        src = pair_index[0]
        dst = pair_index[1]

        return (
            z[src]
            * self.ddi_relation
            * z[dst]
        ).sum(dim=-1)